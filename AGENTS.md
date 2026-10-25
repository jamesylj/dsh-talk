# AGENTS.md

Standalone DeepSeek Harness plugin repository (`dsh-talk`). This is the
**`android` branch**: MiniMax cloud TTS for the
[DeepSeek Harness Android app](https://github.com/woaiys3/deepseek-harness-android-app)
(kernel `0.2.1-rc.2`, WebView UI). The `main` line (0.5.x) is the macOS/Linux
host-played variant with MLX + `ffplay`; keep the branches independent.

**Current line: 0.6.0-android.1 — MiniMax only, Web UI plays the audio.**

## Product shape

- One engine: MiniMax `speech-2.8-turbo` (synchronous T2A endpoint, `stream:
  true`). The host collects the SSE hex MP3 chunks, concatenates the batches of
  one utterance, and queues the MP3.
- No host audio player. The chat UI polls `talk/pending` with a cursor, decodes
  each base64 MP3 into a Blob and plays it through ONE shared `<audio>` element
  (one stream: no overlap). The first pointer gesture unlocks WebView autoplay.
- Composer surface (`conversation.input.left`): an auto/manual mode pill
  (`talk-mode`) and a play/stop button (`talk-voice`, which also owns playback).
  Manual mode silences auto-read and the turn-end announcement; ▶ always works.
  Plus a simplified settings tab (`settings.plugins.tab`, id `talk`).

## Layout

- `src/index.ts` — function plugin (`name`/`inject`/`Config`/`apply`; no default
  export). Injects ONLY `tools` (no subprocess). Mounts the service, the `speak`
  tool, the auto-reply controller (policy `enabled` is a getter over
  `TalkService.mode()`) and one `agent/status` running→idle listener that reads
  the finished turn, or falls back to the "Turn complete." announcement.
- `src/wire.ts` — the `talk` Remote vocabulary (zod codecs + invocation
  descriptors shared by the host `./typert` manifest and the client
  contribution). Methods: `status`, `playLatest`, `stop`, `applyMode`,
  `applySettings`, `pending`. **A descriptor's `method` must name a real
  `TalkService` method** — the host calls it positionally with the decoded
  parameter values, and a parameter codec describes the VALUE the method
  receives (scalar `sessionId`/`mode`/`since`, one object for `settings`).
- `src/service.ts` — `TalkService` (TypertRemoteService, namespace `talk`):
  synthesis, `queue`/`cursor` with `pending(since)` (`-1` = baseline), scoped
  preemption, runtime auto/manual mode, session resolution (`ctx.get('sessions')`
  with newest-live-session fallback), settings write-back.
- `src/minimax.ts` — the engine: batching, request shaping, SSE decoding,
  credential resolution, idle timeout, cancel; returns the full MP3.
  `MINIMAX_MAX_AUDIO_BYTES` (16 MiB) bounds one utterance.
- `src/auto-reply.ts` — pure selection helpers (`findAutoReply`,
  `findLatestAssistantText`, …) plus the stateful `AutoReplyController`.
- `src/speech.ts` — the `plugin:dsh-talk/speech` session event (dual-channel
  gate). Audio bytes never enter the log.
- `src/settings-patch.ts` — append-only profile-patch write-back with
  timestamped backups (voice id + auto-reply switch only).
- `src/diagnostics.ts` — bounded, rotating, redacted
  `~/.dsh-talk/logs/diagnostics.log` for interactive failures;
  `DSH_TALK_LOG_DIR` overrides the directory so tests never write into a home.
- `src/sanitize.ts` — credential/JWT/bearer/control-character redaction.
- `src/client/` — browser half: `TalkModeButton`, `TalkVoiceButton` (polls
  status + pending, owns the shared audio element and the Blob queue),
  `TalkSettingsTab`, the Remote contribution (`remote.ts`), en/zh dictionaries,
  one scoped inline stylesheet. Session-scope slots receive the session id as
  the first `inject(sessionId)` argument — prefer it over the optional standard
  prop.
- `scripts/` — `prepare.mjs` (the single build entry: tsc declarations →
  `lib/types`, tsdown bundles → `lib/index.js` + `lib/typert.host.js` +
  `lib/client.js`), `check-readme-sync.mjs`, `check-lockfile-drift.mjs`,
  `verify-self-contained.mjs`, `verify-artifacts.mjs`, `fix-dts.mjs`.
- `tests/` — vitest against a real Cordis `Context`/`SessionStore`/`ToolRuntime`
  (`tests/harness.ts`), with `tests/minimax.spec.ts` stubbing `fetch` for SSE
  streams, `tests/service.spec.ts` covering the queue/stop/mode/descriptor
  contract, and `tests/wire.spec.ts` pinning the wire shapes.

## Hard rules

- **Model-visible ⟺ logged.** Everything the plugin speaks is appended as a
  speech session event (text, engine, reason, byte count, error); no audio
  bytes. Audio crosses only the local Remote channel and is never written to
  disk.
- **One playback stream.** Never create a second `Audio` element or play two
  utterances at once; keep the shared element + queue in
  `TalkVoiceButton`.
- **Autoplay is gated.** If `play()` rejects with `NotAllowedError`, keep the
  utterance queued, show the blocked hint, and retry on the next gesture.
- **Sanitized everything.** Every display/log surface passes
  `sanitizeText`/`redactSecrets`; credentials never leak.
- **Fail visibly.** Remote methods must exist for their descriptors (tested);
  interactive failures go to the diagnostics log instead of a silent tooltip.
- **No host-side players.** Do not reintroduce `ffplay`/`afplay`/subprocess
  playback or the MLX engine on this branch: the Android runtime has neither.

## Build and checks

`pnpm run build` (`scripts/prepare.mjs`) then `pnpm pack`; install into the
Android app from `github:jamesylj/dsh-talk#android` or a tarball (the app's
plugin page accepts both). Verification set:

```sh
pnpm run typecheck && pnpm run typecheck:ci && pnpm test && pnpm run lint \
  && pnpm run build && pnpm run verify:self-contained \
  && pnpm run verify:artifacts && pnpm run check:readmes \
  && pnpm run check:lockfile
```

`typecheck:ci` resolves the npm-published `0.2.1-rc.2` faces — the same kernel
line the Android app ships.

## Docs

- Five READMEs (`README.md` is the source of truth; `check:readmes` enforces
  equal section counts, one install command and one shared configuration
  table).
- `cordis.patch.yml` documents every config key inline.
- License Apache-2.0; no third-party source is bundled (`THIRD_PARTY_NOTICES.md`).
