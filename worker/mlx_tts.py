#!/usr/bin/env python3
"""One-shot MLX TTS renderer for dsh-talk.

Loads a quantized Qwen3-TTS model, splits the text on sentence boundaries,
synthesizes every chunk, plays each chunk as soon as it exists through the
configured system player, and writes the concatenated 24 kHz mono WAV to
--out. The host waits for this process; killing it (SIGTERM/SIGINT) stops the
active player and exits 143 so the plugin can classify it as interrupted.

Usage:
  python mlx_tts.py --model <dir> --voice Vivian --lang Chinese \
      --chunk-chars 100 --player /usr/bin/afplay --out /tmp/full.wav
  (the text to speak arrives on stdin)
"""
import argparse
import json
import re
import signal
import subprocess
import sys
import time

import numpy as np
import soundfile as sf


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def split_text(text: str, max_chars: int) -> list[str]:
    """Split on Chinese/English sentence enders, then hard-split overlong parts."""
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
    # Merge short fragments so tiny sentences do not pay per-call overhead.
    merged: list[str] = []
    for part in parts:
        if merged and len(merged[-1]) + len(part) <= max_chars:
            merged[-1] += part
        else:
            merged.append(part)
    return [part for part in merged if part.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--voice", default="Vivian")
    parser.add_argument("--lang", default="Chinese")
    parser.add_argument("--chunk-chars", type=int, default=100)
    parser.add_argument("--player", default="/usr/bin/afplay")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    text = sys.stdin.read().strip()
    if text == "":
        emit({"phase": "error", "message": "empty text"})
        return 2

    players: list[subprocess.Popen] = []
    stopping = False

    def stop_players(*_args) -> None:
        nonlocal stopping
        stopping = True
        for player in players:
            try:
                player.terminate()
            except Exception:
                pass
        sys.exit(143)

    signal.signal(signal.SIGTERM, stop_players)
    signal.signal(signal.SIGINT, stop_players)

    started = time.time()
    from mlx_audio.tts.utils import load_model  # imported late: keeps --help fast

    model = load_model(args.model)
    emit({"phase": "loaded", "loadSec": round(time.time() - started, 2)})

    chunks = split_text(text, args.chunk_chars)
    emit({"phase": "plan", "chunks": len(chunks), "chars": len(text)})

    synth_started = time.time()
    first_audio_at: float | None = None
    audio_parts: list[np.ndarray] = []
    sample_rate = 24000
    for index, chunk in enumerate(chunks):
        if stopping:
            return 143
        chunk_started = time.time()
        parts: list[np.ndarray] = []
        for result in model.generate_custom_voice(
            text=chunk,
            speaker=args.voice,
            language=args.lang,
            stream=True,
            streaming_interval=0.32,
        ):
            parts.append(np.array(result.audio))
        audio = np.concatenate(parts) if parts else np.array([], dtype=np.float32)
        audio_parts.append(audio)
        if first_audio_at is None:
            first_audio_at = time.time() - started
        # Play this chunk immediately while the next one synthesizes.
        chunk_path = f"{args.out}.{index:03d}.wav"
        sf.write(chunk_path, audio, sample_rate, subtype="PCM_16")
        try:
            players.append(subprocess.Popen([args.player, chunk_path]))
        except Exception as error:  # playing is best-effort; the WAV still lands
            emit({"phase": "player-error", "message": str(error)})
        emit({
            "phase": "chunk",
            "index": index,
            "chars": len(chunk),
            "synthSec": round(time.time() - chunk_started, 2),
            "audioSec": round(len(audio) / sample_rate, 2),
            "firstAudioSec": round(first_audio_at, 2) if first_audio_at is not None else None,
        })

    if audio_parts:
        full = np.concatenate(audio_parts)
    else:
        full = np.array([], dtype=np.float32)
    sf.write(args.out, full, sample_rate, subtype="PCM_16")
    for player in players:
        try:
            player.wait()
        except Exception:
            pass
    emit({
        "phase": "done",
        "audioSec": round(len(full) / sample_rate, 2),
        "synthSec": round(time.time() - synth_started, 2),
        "firstAudioSec": round(first_audio_at, 2) if first_audio_at is not None else None,
    })
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # surface a bounded, parseable failure
        sys.stderr.write(f"mlx_tts: {error}\n")
        sys.exit(1)
