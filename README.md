<div align="center">

# 🎙️ dsh-talk

**Host-played text-to-speech for DeepSeek Harness: the agent's replies are read
aloud, and two composer buttons switch the auto/manual mode and read — or
stop — the latest reply.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![npm version](https://img.shields.io/npm/v/dsh-talk)](https://www.npmjs.com/package/dsh-talk)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```

</div>

## Install

```sh
# git channel (latest main)
dsh plugin --profile web add github:jamesylj/dsh-talk

# npm channel (published releases)
dsh plugin --profile web add dsh-talk

# tarball channel
pnpm pack && dsh plugin --profile web add ./dsh-talk-<version>.tgz
```

Uninstall with `dsh plugin --profile web remove dsh-talk`.

**GitHub path, no npm needed:** install straight from this repository — DSH Desktop →
**Plugins → Add plugin**, or `dsh plugin add github:jamesylj/dsh-talk#v0.5.3`. The
`main` line is `github:jamesylj/dsh-talk#v0.5.3`; the Android line is
`github:jamesylj/dsh-talk#v0.6.0-android.1` (or `#android` for its latest
commit). Git is required and the package's build script must be approved once.
Full steps: [docs/install-github.md](docs/install-github.md).

## What it does

- **`speak` tool** — the agent speaks a reply on the host machine.
- **Auto-reply** — when a turn ends, the assistant's final reply is read aloud
  automatically (code blocks stripped, long replies capped by `autoReply.maxChars`).
- **Composer play button** — click to read the newest assistant reply of the
  current session; click again while it is speaking to stop it.
- **Composer mode button** — switch between **auto** (replies are read aloud
  automatically) and **manual** (the plugin stays silent until you click ▶).
  The switch is runtime state: no config write, no reload.
- **Turn-end announcement** — a short "Turn complete." line when a finished turn
  was not auto-read and nothing else is playing.
- **Optional audio export** — every host synthesis can be written to a bounded
  file directory and returned as `audioPath` (off by default).

Voice input, browser `<audio>` playback, edge-tts, piper, the macOS `say` engine
and the settings write-back of v0.4 were removed in 0.5: both remaining engines
play on the host, so the browser never fetches audio and no playback
projection is needed.

## Quick start

1. Install the bundle and restart the profile.
2. Configure an engine (see Configuration). MiniMax is the default and needs an
   API key; MLX is the offline clone fallback.
3. Ask the agent to use `speak`, or just send a normal message — the reply is
   read aloud when the turn ends.
4. Use the auto/manual pill next to the composer to change the mode, and the
   ▶ / ⏹ button to replay or stop the latest reply.

`ffplay` (from Homebrew `ffmpeg`) must be on the host `PATH` for MiniMax
playback: `brew install ffmpeg`.

## Configuration

All keys live under the `talk` row's `config` in the profile patch layer.
`cordis.patch.yml` in this repository documents each key inline.

| Key | Default | Meaning |
|---|---|---|
| `tts.engine` / `tts.fallback` | `minimax` / `true` | Engine (`minimax` or `mlx`); when MiniMax fails, retry with MLX if a reference WAV is configured |
| `tts.minimax.apiKeyEnv` / `tts.minimax.credentialsFile` | `MINIMAX_CN_API_KEY` / `~/.dsh/.credentials.yaml` | Where the API key is read from (environment first, then the harness credential store's `refs:` section); the key is never logged |
| `tts.minimax.baseUrl` / `tts.minimax.model` / `tts.minimax.voiceId` | `https://api.minimax.cn/v1/t2a_v2` / `speech-2.8-turbo` / `Chinese (Mandarin)_Warm_Girl` | Endpoint, model id and system voice id |
| `tts.minimax.player` / `tts.minimax.chunkChars` / `tts.minimax.requestTimeoutMs` | `ffplay` / `2000` / `120000` | Streaming player, characters per request (long text is split at sentence boundaries), and the idle timeout in milliseconds |
| `tts.mlx.command` / `tts.mlx.script` / `tts.mlx.model` / `tts.mlx.refAudio` | venv python / bundled worker / Base 4-bit model / *(none)* | Local Qwen3-TTS Base clone engine: interpreter, worker, model directory and the x-vector reference WAV |
| `tts.export.enabled` / `tts.export.dir` | `false` / `<home>/.dsh-talk/audio` | Write host-synthesized audio to a file and return `audioPath` |
| `announce.enabled` | `true` | Speak the turn-end line when a turn was not auto-read |
| `autoReply.enabled` / `autoReply.maxChars` | `true` / `600` | Automatic read-aloud of the final reply and its character cap |
| `maxSpeakChars` | `20000` | Cap on one `speak` tool request |

## Host playback engine

- **MiniMax** (`speech-2.8-turbo`): the synchronous T2A endpoint is called with
  `stream: true`; hex MP3 chunks from the SSE stream are written straight into
  one `ffplay` process's stdin. The first word starts in a few hundred
  milliseconds and a long reply plays as one continuous stream. Requests longer
  than `tts.minimax.chunkChars` are split at sentence boundaries while the same
  player keeps playing.
- **MLX** (offline): a resident Python worker keeps a quantized Qwen3-TTS
  **Base** model warm and clones the `tts.mlx.refAudio` speaker with x-vector
  only (no preset voice, no ICL reference transcript). Fragments are queued into
  one continuous `sounddevice` output stream.
- A new utterance only stops speech the **same session** already had in flight;
  auto-read and announcements pass `interrupt: false`, so a long read finishes.
- The composer ▶ button reads the newest assistant reply through the same
  pipeline and stops it with `talk/stop`; the auto/manual pill only switches the
  mode, so the ▶ button always works in manual mode.

## MiniMax setup

Put the API key in the environment used to start the harness, or leave it in
the harness credential store (`refs:` in `~/.dsh/.credentials.yaml`):

```sh
export MINIMAX_CN_API_KEY=...
```

Common Mandarin voices: `Chinese (Mandarin)_Warm_Girl`, `female-yujie`,
`Chinese (Mandarin)_Gentleman`, `Chinese (Mandarin)_News_Anchor`. Pricing is
about ¥2 per 10,000 characters (one Chinese character counts as two). The
spoken text leaves the machine and is billed per character.

## MLX clone setup

1. Create a Python venv with `mlx-audio` at `~/.dsh-talk/mlx-tts-venv`.
2. Download a Qwen3-TTS **Base** 4-bit MLX checkpoint to
   `~/.dsh-talk/models/qwen3-tts-0.6b-base-4bit`.
3. Create a short reference WAV (for example with
   `say -v "Lilian (Premium)" -o ~/.dsh-talk/voices/lilian-ref.wav --file-format=WAVE --data-format=LEI16@24000 -f -`)
   and point `tts.mlx.refAudio` at it.

Then set `tts.engine: mlx` (or keep `minimax` and let
`tts.fallback: true` fall back to MLX when the cloud call fails).

## Play button and settings

The mode pill in `conversation.input.left` shows `Auto` or `Manual`:

- **Auto** — every finished reply is read aloud (subject to `autoReply.enabled`,
  the turn-end reasons and `announce.enabled`).
- **Manual** — the host stays completely silent after a turn; only the ▶ button
  speaks. A click switches to the other mode immediately via `talk/applyMode`.

The ▶ / ⏹ button next to it shows ▶ when idle and ⏹ while speaking. Clicking it
calls `talk/playLatest` with the current session id, or `talk/stop` when audio
is playing. The mode is runtime state: a restart falls back to the configured
`autoReply.enabled` default, and the settings tab's auto-reply switch both
mirrors the current mode and persists it. Saving the settings tab appends one
row operation to the profile patch layer (reload to apply).

## Troubleshooting

- **No sound from MiniMax**: `ffplay` missing (`brew install ffmpeg`) or no API
  key. The speak result carries the sanitized error; the session log records a
  `plugin:dsh-talk/speech` event with `error`.
- **Auth errors**: `minimax: 1004: invalid api key` means the key was not found
  in the environment or the credential store.
- **MLX worker slow to start**: the first request loads the model (a few
  seconds); later requests reuse the warm worker.
- **Long read cut off**: check the session log for `interrupted`, and remember
  that a new utterance from the same session preempts the current one.
- **A composer button seems to do nothing**: read the bounded diagnostics log
  at `~/.dsh-talk/logs/diagnostics.log` — failed play/stop calls are recorded
  there (credentials redacted).

## Security and development

- The API key is resolved per utterance and never logged; error text is
  sanitized before it reaches the session log or the tool result.
- Every spoken utterance is recorded as a `plugin:dsh-talk/speech` session
  event (text, engine, reason, byte count, error) — no audio bytes in the log.
- Interactive failures (a composer Remote call that cannot run) append a
  bounded, secret-redacted line to `~/.dsh-talk/logs/diagnostics.log`.
- Checks: `pnpm run typecheck && pnpm run typecheck:ci && pnpm test &&
  pnpm run build && pnpm run verify:self-contained && pnpm run verify:artifacts
  && pnpm run check:readmes && pnpm run check:lockfile`.

## License

Apache-2.0.
