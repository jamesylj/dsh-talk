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

This is the **android** line of the plugin: MiniMax cloud text-to-speech for the
DeepSeek Harness Android app (WebView UI). One engine remains — MiniMax
`speech-2.8-turbo` — and the synthesized MP3 is played by the Web UI, not by a
host process. There is no local TTS model, no audio player subprocess, no
microphone input, and no audio export to disk. Its own guarantees:

- Audio bytes never enter the model context or the session log. Only sanitized
  metadata (utterance id, engine, reason, byte count, error, and the spoken
  text) is logged as a `plugin:dsh-talk/speech` session event.
- Synthesized audio stays in host memory until the Web UI drains it through the
  local Remote channel; it is never written to a file, and ⏹ drops the queue.
  The queue is bounded (6 utterances / 24 MiB) and a 16 MiB per-utterance cap
  fails loudly instead of exhausting memory.
- Spoken text and every display/log surface pass the sanitizers (credentials,
  JWTs, bearer headers, control characters, temp paths are redacted or bounded).
  The diagnostics log is bounded (256 KiB, one rotation) and redacted.
- **MiniMax leaves the device**: the text you hear is sent to MiniMax for
  synthesis and billed per character, under MiniMax's terms. The API key is
  resolved per utterance from the configured environment variable or the
  harness credential store and is never logged.
- The plugin spawns no local process and declares only `network:outbound`; the
  installed app's own sandbox and permission model apply to everything else.
- The settings tab writes config only as append-only profile-patch fragments
  with a timestamped backup; it never rewrites the profile file.

Vulnerabilities in the harness or in the Android app itself should be reported
to their respective maintainers instead.
