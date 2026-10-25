#!/usr/bin/env python3
"""Resident MLX TTS worker for dsh-talk.

One process, one model load, JSON-lines protocol on stdin/stdout:

  <- {"type":"ready"}                      (after the model is loaded)
  -> {"id":"...","text":"...","voice":"Vivian","chunkChars":100,"outDir":"/tmp/x"}
  <- {"type":"accepted"|"chunk"|"done"|"error"|"cancelled", ...}
  -> {"type":"cancel","id":"..."}           (stops the active request, keeps the model warm)

Synthesis streams through the model (`stream=True`); every generated fragment is
queued into ONE continuous sounddevice output stream, so sentences never
overlap and there are no per-chunk player gaps. When PortAudio is unavailable
the worker falls back to one blocking playback of the finished WAV, still with
no overlap. The concatenated 24 kHz mono WAV is written to outDir/<id>.wav.
"""
import argparse
import json
import os
import queue
import re
import signal
import subprocess
import sys
import threading
import time

import numpy as np
import soundfile as sf


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def normalize_for_speech(text: str) -> str:
    """Turn markdown-ish replies into plain spoken text.

    Tables, emphasis markers, headings, links and bare URLs are the usual
    source of odd syllables (and occasional language drift) in a TTS model;
    they are collapsed to plain sentences before any synthesis happens.
    """
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)  # [label](url) -> label
    text = re.sub(r"https?://\S+", "", text)                 # bare URLs
    text = re.sub(r"\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?", "，", text)  # |---|---|
    text = text.replace("|", "，")
    text = re.sub(r"[*_`#>]+", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n+", "。", text)
    text = re.sub(r"[，。]{2,}", "。", text)
    text = re.sub(r"^\s*[，。]+", "", text)
    return text.strip()


def split_text(text: str, max_chars: int) -> list[str]:
    parts: list[str] = []
    for sentence in re.split(r"(?<=[。！？；!?;\n])", text):
        if sentence == "":
            continue
        while len(sentence) > max_chars:
            cut = sentence.rfind("，", 0, max_chars)
            if cut < max_chars // 2:
                cut = max_chars
            parts.append(sentence[:cut])
            sentence = sentence[cut:]
        if sentence:
            parts.append(sentence)
    merged: list[str] = []
    for part in parts:
        if merged and len(merged[-1]) + len(part) <= max_chars:
            merged[-1] += part
        else:
            merged.append(part)
    return [part for part in merged if part.strip()]


class StreamPlayer:
    """One continuous output stream; enqueue() appends, silence fills underruns."""

    def __init__(self, sample_rate: int = 24000, buffer_seconds: float = 1.5) -> None:
        self.sample_rate = sample_rate
        self.buffer_seconds = buffer_seconds
        self.buffer: list[np.ndarray] = []
        self.lock = threading.Lock()
        self.stream = None
        self.started = False
        self.total_queued = 0
        self.played = 0

    def _callback(self, outdata, frames, _time, _status) -> None:
        outdata.fill(0)
        with self.lock:
            offset = 0
            while self.buffer and offset < frames:
                head = self.buffer[0]
                take = min(len(head), frames - offset)
                outdata[offset:offset + take, 0] = head[:take]
                if take == len(head):
                    self.buffer.pop(0)
                else:
                    self.buffer[0] = head[take:]
                offset += take
                self.played += take

    def _start(self) -> None:
        if self.started:
            return
        import sounddevice as sd

        self.stream = sd.OutputStream(
            samplerate=self.sample_rate,
            channels=1,
            callback=self._callback,
            blocksize=2048,
        )
        self.stream.start()
        self.started = True

    def enqueue(self, samples) -> None:
        array = np.asarray(samples, dtype=np.float32).reshape(-1)
        if array.size == 0:
            return
        with self.lock:
            self.buffer.append(array)
            self.total_queued += array.size
            buffered = sum(len(item) for item in self.buffer)
        if not self.started and buffered >= int(self.buffer_seconds * self.sample_rate):
            self._start()

    def wait_drained(self) -> None:
        self._start()
        while True:
            with self.lock:
                if self.played >= self.total_queued and not self.buffer:
                    break
            time.sleep(0.05)
        time.sleep(0.15)  # let the device finish its pending block

    def stop(self) -> None:
        if self.stream is not None:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None
            self.started = False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--voice", default="Vivian")
    parser.add_argument("--lang", default="Chinese")
    parser.add_argument("--chunk-chars", type=int, default=100)
    parser.add_argument("--buffer-seconds", type=float, default=1.5)
    parser.add_argument("--player", default="/usr/bin/afplay")
    parser.add_argument("--temperature", type=float, default=0.6)
    parser.add_argument("--top-p", type=float, default=0.9)
    parser.add_argument("--top-k", type=int, default=30)
    args = parser.parse_args()

    from mlx_audio.tts.utils import load_model

    emit({"type": "loading"})
    model = load_model(args.model)
    emit({"type": "ready"})

    requests: "queue.Queue[dict]" = queue.Queue()
    state = {"current": None, "cancel": threading.Event()}
    lock = threading.Lock()

    def reader() -> None:
        for line in sys.stdin:
            line = line.strip()
            if line == "":
                continue
            try:
                message = json.loads(line)
            except Exception:
                continue
            if message.get("type") == "cancel":
                target = message.get("id")
                with lock:
                    if state["current"] == target:
                        state["cancel"].set()
                continue
            requests.put(message)

    threading.Thread(target=reader, daemon=True).start()

    def on_signal(*_args) -> None:
        with lock:
            state["cancel"].set()
        sys.exit(143)

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    while True:
        request = requests.get()
        request_id = str(request.get("id", ""))
        text = normalize_for_speech(str(request.get("text", "")))
        voice = str(request.get("voice") or args.voice)
        chunk_chars = int(request.get("chunkChars") or args.chunk_chars)
        out_dir = str(request.get("outDir") or "")
        with lock:
            state["current"] = request_id
            state["cancel"].clear()
        if text == "":
            emit({"type": "error", "id": request_id, "message": "empty text"})
            with lock:
                state["current"] = None
            continue

        emit({"type": "accepted", "id": request_id, "chars": len(text)})
        started = time.time()
        player = StreamPlayer(buffer_seconds=args.buffer_seconds)
        player_ok = True
        pieces: list[np.ndarray] = []
        first_audio = None
        try:
            chunks = split_text(text, chunk_chars)
            for index, chunk in enumerate(chunks):
                if state["cancel"].is_set():
                    break
                for result in model.generate_custom_voice(
                    text=chunk,
                    speaker=voice,
                    language=args.lang,
                    temperature=args.temperature,
                    top_p=args.top_p,
                    top_k=args.top_k,
                    stream=True,
                    streaming_interval=0.32,
                ):
                    if state["cancel"].is_set():
                        break
                    audio = np.asarray(result.audio, dtype=np.float32).reshape(-1)
                    if audio.size == 0:
                        continue
                    pieces.append(audio)
                    if first_audio is None:
                        first_audio = time.time() - started
                    if player_ok:
                        try:
                            player.enqueue(audio)
                        except Exception as error:
                            player_ok = False
                            player.stop()
                            emit({"type": "warning", "id": request_id, "message": f"audio device unavailable: {error}"})
                if state["cancel"].is_set():
                    break
                emit({
                    "type": "chunk",
                    "id": request_id,
                    "index": index,
                    "chars": len(chunk),
                })
            if state["cancel"].is_set():
                player.stop()
                emit({"type": "cancelled", "id": request_id})
                continue
            full = np.concatenate(pieces) if pieces else np.array([], dtype=np.float32)
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(out_dir, f"{request_id}.wav")
            sf.write(out_path, full, 24000, subtype="PCM_16")
            if player_ok and player.started:
                player.wait_drained()
                player.stop()
            elif player_ok:
                player.stop()
                subprocess.run([args.player, out_path], check=False)
            else:
                subprocess.run([args.player, out_path], check=False)
            emit({
                "type": "done",
                "id": request_id,
                "file": out_path,
                "audioSec": round(len(full) / 24000, 2),
                "firstAudioSec": round(first_audio, 2) if first_audio is not None else None,
                "synthSec": round(time.time() - started, 2),
            })
        except Exception as error:
            player.stop()
            emit({"type": "error", "id": request_id, "message": str(error)[:500]})
        finally:
            with lock:
                state["current"] = None
                state["cancel"].clear()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        sys.stderr.write(f"mlx_tts: {error}\n")
        sys.exit(1)
