<div align="center">

# 🎙️ dsh-talk (android)

**MiniMax cloud text-to-speech for the Android build of DeepSeek Harness: the
agent's replies are read aloud, the Web UI plays the audio, and two composer
buttons switch the auto/manual mode and read — or stop — the latest reply.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```

</div>

## Install

```sh
# git channel, android branch (the target of this README)
dsh plugin --profile web add github:jamesylj/dsh-talk#android

# tarball channel (build this branch first)
pnpm pack && dsh plugin --profile web add ./dsh-talk-<version>.tgz
```

Uninstall with `dsh plugin --profile web remove dsh-talk`.

## What it does

- **`speak` tool** — the agent speaks a reply through MiniMax `speech-2.8-turbo`.
- **Auto-reply** — when a turn ends, the assistant's final reply is read aloud
  automatically (code blocks stripped, long replies capped by `autoReply.maxChars`).
- **Composer play button** — click to read the newest assistant reply of the
  current session; click again while it is speaking to stop it.
- **Composer mode button** — switch between **auto** (replies are read aloud
  automatically) and **manual** (the plugin stays silent until you click ▶).
  The switch is runtime state: no config write, no reload.
- **Turn-end announcement** — a short "Turn complete." line when a finished turn
  was not auto-read and nothing else is playing.

This branch is Android-only by design: the local MLX Qwen3-TTS engine and the
host-side `ffplay` player from the `main` (macOS/Linux) line are gone. The
Android runtime has neither Apple-silicon MLX nor a host audio player, so the
host synthesizes the MP3 and the DeepSeek Harness Web UI plays it in the WebView.

## Quick start

1. Install the plugin into the Android DeepSeek Harness app (see Android setup).
2. Configure the MiniMax API key (`MINIMAX_CN_API_KEY` or the harness credential
   store). No other engine needs to be installed.
3. Ask the agent to use `speak`, or just send a normal message — the reply is
   read aloud when the turn ends and the chat UI plays it.
4. Use the auto/manual pill next to the composer to change the mode, and the
   ▶ / ⏹ button to replay or stop the latest reply.

## Configuration

All keys live under the `talk` row's `config` in the profile patch layer.
`cordis.patch.yml` in this repository documents each key inline.

| Key | Default | Meaning |
|---|---|---|
| `tts.minimax.apiKeyEnv` / `tts.minimax.credentialsFile` | `MINIMAX_CN_API_KEY` / `~/.dsh/.credentials.yaml` | Where the API key is read from (environment first, then the harness credential store's `refs:` section); the key is never logged |
| `tts.minimax.baseUrl` / `tts.minimax.model` / `tts.minimax.voiceId` | `https://api.minimax.cn/v1/t2a_v2` / `speech-2.8-turbo` / `Chinese (Mandarin)_Warm_Girl` | Endpoint, model id and system voice id |
| `tts.minimax.chunkChars` / `tts.minimax.requestTimeoutMs` | `2000` / `120000` | Characters per API request (long text is split at sentence boundaries, the pieces are concatenated) and the idle timeout in milliseconds |
| `announce.enabled` | `true` | Speak the turn-end line when a turn was not auto-read |
| `autoReply.enabled` / `autoReply.maxChars` | `true` / `600` | Automatic read-aloud of the final reply and its character cap |
| `maxSpeakChars` | `20000` | Cap on one `speak` tool request |

## How playback works

There is no host audio player in this branch:

1. The host calls the synchronous MiniMax T2A endpoint with `stream: true`,
   decodes the hex MP3 chunks from the SSE stream, concatenates the batches of
   one utterance, and queues the MP3 (bounded: at most 6 utterances / 24 MiB).
2. The chat UI polls `talk/pending` with a cursor, decodes each base64 MP3 into a
   Blob and plays it through one shared `<audio>` element, one utterance at a
   time. Auto-reply audio therefore arrives in the WebView, not from a local
   process.
3. The ▶ button calls `talk/playLatest` with the current session id; ⏹ stops the
   local element and calls `talk/stop`, which aborts synthesis and drops the
   queue. A new utterance only interrupts the **same session**; auto-read and
   announcements use `interrupt: false`, so a long read plays to completion.

Android WebView may require a user gesture before media may start. The first tap
anywhere in the page unlocks the player; if playback is still refused, the
button tooltip says so and the next gesture retries.

## MiniMax setup

Put the API key in the environment used to start the harness, or leave it in
the harness credential store (`refs:` in `~/.dsh/.credentials.yaml`):

```sh
export MINIMAX_CN_API_KEY=...
```

Common Mandarin voices: `Chinese (Mandarin)_Warm_Girl`, `female-yujie`,
`Chinese (Mandarin)_Gentleman`, `Chinese (Mandarin)_News_Anchor`. Pricing is
about ¥2 per 10,000 characters (one Chinese character counts as two). The
spoken text leaves the device and is billed per character.

## Android setup

1. Install [DeepSeek Harness for Android](https://github.com/woaiys3/deepseek-harness-android-app)
   (stock kernel `0.2.1-rc.2`; this branch's peer line matches it).
2. In the app: 控制台 →「插件」, install from the GitHub address
   `github:jamesylj/dsh-talk#android` (the app bundles pnpm and git), or copy a
   built tarball to the device and install from a local directory.
3. Add the `talk` row to the profile patch layer if the bundle does not insert
   it, then start the engine and fill the API key.
4. Open a conversation: the two buttons appear left of the composer.

The plugin needs only outbound network access; it spawns no local process.

## Play button, mode button and settings

The mode pill in `conversation.input.left` shows `Auto` or `Manual`:

- **Auto** — every finished reply is read aloud (subject to `autoReply.enabled`,
  the turn-end reasons and `announce.enabled`).
- **Manual** — the host stays completely silent after a turn; only the ▶ button
  speaks. A click switches to the other mode immediately via `talk/applyMode`.

The ▶ / ⏹ button next to it shows ▶ when idle and ⏹ while audio is playing or
synthesizing. The mode is runtime state: a restart falls back to the configured
`autoReply.enabled` default, and the settings tab's auto-reply switch both
mirrors the current mode and persists it. The settings tab also exposes the
MiniMax voice id; saving appends one row operation to the profile patch layer
(reload to apply).

## Troubleshooting

- **No sound**: the MiniMax API key is missing (`minimax: no API key`), the
  phone is offline, or the WebView is still waiting for a user gesture — tap
  anywhere once, then press ▶.
- **Auth errors**: `minimax: 1004: invalid api key` means the key was not found
  in the environment or the credential store.
- **A composer button seems to do nothing**: read the bounded diagnostics log at
  `~/.dsh-talk/logs/diagnostics.log` — failed play/stop calls are recorded there
  (credentials redacted).
- **Long read cut off**: check the session log for `interrupted`; the queue keeps
  at most 6 utterances / 24 MiB and an utterance longer than 16 MiB of MP3 fails
  with a clear engine error.

## Security and development

- The API key is resolved per utterance and never logged; error text is
  sanitized before it reaches the session log or the tool result.
- Every spoken utterance is recorded as a `plugin:dsh-talk/speech` session
  event (text, engine, reason, byte count, error) — no audio bytes in the log.
- Synthesized audio crosses the local Remote channel only, is never written to
  disk, and is dropped from the queue after playback or on ⏹.
- Interactive failures append a bounded, secret-redacted line to
  `~/.dsh-talk/logs/diagnostics.log`.
- Checks: `pnpm run typecheck && pnpm run typecheck:ci && pnpm test &&
  pnpm run build && pnpm run verify:self-contained && pnpm run verify:artifacts
  && pnpm run check:readmes && pnpm run check:lockfile`.

## License

Apache-2.0.
