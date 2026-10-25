# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately through GitHub's private vulnerability reporting:

**https://github.com/jamesylj/dsh-talk/security/advisories/new**

That flow keeps the report confidential while we triage, and it is the channel we watch first.

## Before you report

- **Redact sensitive data** from any logs or session excerpts you attach: tokens, API keys, secrets, Authorization/request headers, personal paths, and account identifiers. Trimmed stack traces are usually enough.
- Include, when possible: the plugin version, the harness (`dsh`) version, Node and OS versions, and the minimal steps to reproduce.

## What to expect

- **Acknowledgment**: within 5 business days.
- **Triage**: within 10 business days we confirm the issue and assess severity, or ask for more details.
- **Fix**: security fixes are prepared in a private fork, released as a patch version, and announced in the release notes.

## Disclosure and credit

- We follow coordinated disclosure: a public advisory (and CVE request where appropriate) is published once a fix ships.
- Reporters are credited in the advisory unless they ask to remain anonymous. There is no bug bounty program at this time.

## Scope

This plugin gives the harness host-played text-to-speech: automatic read-aloud of
finished replies, a `speak` tool, and two composer controls (auto/manual mode and
play/stop). Two engines remain: **MiniMax** `speech-2.8-turbo` (cloud) and a local
**Qwen3-TTS Base / MLX** clone worker. There is no microphone input, no
transcription, and no browser audio playback. Its own guarantees:

- Audio bytes never enter the model context, the session log, or the
  diagnostics log — only sanitized metadata (utterance id, engine, reason, byte
  count, error, and the spoken text) is logged as a `plugin:dsh-talk/speech`
  session event. Server and connection state are not logged.
- Spoken text and every display/log surface pass the sanitizers (credentials,
  JWTs, bearer headers, control characters, temp paths are redacted or bounded).
  The diagnostics log is bounded (256 KiB, one rotation) and redacted.
- Local engines run through the official `ctx.subprocess` seam with argv arrays
  (no shell string interpolation) and abort-signal wiring; the MLX model runs in
  the configured Python venv. `ffplay` (Homebrew `ffmpeg`) is used only as the
  MiniMax streaming player and is never given text.
- **MiniMax leaves the machine**: the text you hear is sent to MiniMax for
  synthesis and billed per character, under MiniMax's terms. The API key is
  resolved per utterance from the configured environment variable or the
  harness credential store and is never logged or written to the export
  directory.
- The settings tab writes config only as append-only profile-patch fragments
  with a timestamped backup; it never rewrites the profile file.
- Audio export is **off by default** (`tts.export.enabled: false`). When enabled,
  synthesized audio is written to a bounded directory (`<home>/.dsh-talk/audio`
  by default; at most 20 files / 24 hours, matching names only) and the file path
  is returned in the speak outcome. Deleting that directory removes the
  persisted audio.
- MiniMax model output is untrusted input to the player only; the plugin never
  treats synthesized bytes as executable content.

Vulnerabilities in the harness itself should be reported to the official harness maintainers instead.
