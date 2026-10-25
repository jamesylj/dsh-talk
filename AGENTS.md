# AGENTS.md

Standalone DeepSeek Harness plugin repository (`dsh-talk`). Development follows
the plugin contract in `@deepseek-ai/dsh-*`; this file records the decisions a
future coding agent needs. **Current line: 0.5.3 — host-played TTS only.**

## Product shape

Two engines, both playing on the host machine (the browser never fetches audio):

- **MiniMax** `speech-2.8-turbo`: the synchronous T2A endpoint is called with
  `stream: true`; hex MP3 chunks from the SSE stream are written into one
  `ffplay` process stdin. Requests longer than `tts.minimax.chunkChars` split at
  sentence boundaries while the same player keeps playing.
- **MLX** (offline): a resident Python worker keeps a quantized Qwen3-TTS
  **Base** model warm and clones the `tts.mlx.refAudio` speaker with x-vector
  only (no preset voice, no ICL transcript); fragments queue into one
  `sounddevice` output stream. MiniMax failures fall back to MLX when
  `tts.fallback` and a reference WAV are configured.

Composer surface (`conversation.input.left`): an **auto/manual mode pill**
(`talk-mode`) and a **play/stop button** (`talk-voice`). Manual mode silences
auto-read and the turn-end announcement; the play button always works. Plus a
simplified settings tab (`settings.plugins.tab`, id `talk`).

## Layout

- `src/index.ts` — function plugin (`name`/`inject`/`Config`/`apply`; no default
  export). Injects `tools` + `subprocess`. Mounts the service, the `speak` tool,
  the auto-reply controller (policy `enabled` is a getter over
  `TalkService.mode()`) and one `agent/status` running→idle listener that reads
  the finished turn, or falls back to the "Turn complete." announcement.
- `src/wire.ts` — the `talk` Remote vocabulary (zod codecs + invocation
  descriptors shared by the host `./typert` manifest and the client contribution).
  Methods: `status`, `playLatest`, `stop`, `applyMode`, `applySettings`.
  **A descriptor's `method` must name a real `TalkService` method** — the host
  calls it positionally with the decoded parameter values, and a parameter
  codec describes the VALUE the method receives (scalar for `sessionId`/`mode`,
  one object for `settings`). `tests/service.spec.ts` asserts the coverage.
- `src/service.ts` — `TalkService` (TypertRemoteService, namespace `talk`):
  scoped preemption, MiniMax → MLX fallback, optional bounded export, speech
  event log, runtime auto/manual mode, session resolution. The settings tab's
  profile patch path is read structurally (`ctx.baseUrl`).
- `src/minimax.ts` / `src/mlx.ts` / `src/engine.ts` — the two engines plus
  `EngineFailure`. The MiniMax idle budget resets on every SSE read and player
  write (long replies must not hit a total deadline), and player stdin carries
  an `error` listener (an unhandled EPIPE once crashed the host).
- `src/auto-reply.ts` — pure selection helpers (`findAutoReply`,
  `findLatestAssistantText`, `stripCodeBlocks`, `truncateAtWhitespace`,
  `prepareAutoReplyText`) plus the stateful `AutoReplyController`.
- `src/audio-export.ts` — UTC-stamped `speech-<stamp>-<token>.<ext>` names,
  home-relative directory, age-then-count prune, only matching names unlinked.
- `src/speech.ts` — the `plugin:dsh-talk/speech` session event (dual-channel
  gate: plain known-vocabulary event or the ignorable plugin record). Audio
  bytes never enter the log.
- `src/settings-patch.ts` — append-only profile-patch write-back with
  timestamped backups.
- `src/diagnostics.ts` — bounded, rotating, redacted
  `~/.dsh-talk/logs/diagnostics.log` for interactive failures (a composer
  Remote call that cannot run, an engine fallback); `DSH_TALK_LOG_DIR`
  overrides the directory so tests never write to a developer's home.
- `src/sanitize.ts` — credential/JWT/bearer/control-character redaction. Pattern
  order is load-bearing.
- `src/client/` — browser half: `TalkModeButton`, `TalkVoiceButton`,
  `TalkSettingsTab`, the Remote contribution (`remote.ts`), en/zh dictionaries,
  and one scoped inline stylesheet (standalone bundles cannot use the in-repo
  CSS-module pipeline). Session-scope slots receive the session id as the first
  `inject(sessionId)` argument — prefer it over the optional standard prop.
- `worker/mlx_tts.py` — JSON-lines resident worker (`accepted`/`chunk`/`done`/
  `cancelled`/`error`; `cancel` stops the active request, keeps the model warm,
  and stops the `sounddevice` stream).
- `scripts/` — `prepare.mjs` (the single build entry: tsc declarations →
  `lib/types`, tsdown bundles → `lib/index.js` + `lib/typert.host.js` +
  `lib/client.js`), `check-readme-sync.mjs`, `check-lockfile-drift.mjs`,
  `verify-self-contained.mjs`, `verify-artifacts.mjs`, `fix-dts.mjs`.
- `tests/` — vitest against a real Cordis `Context`/`SessionStore`/`ToolRuntime`
  with a scripted `SubprocessRuntime` subclass (`tests/harness.ts`), plus
  `tests/wire.spec.ts` (descriptor shapes) and `tests/diagnostics.spec.ts`.

## Hard rules

- **Model-visible ⟺ logged.** Everything the plugin speaks is appended as a
  speech session event (text, engine, reason, byte count, error); no audio
  bytes. The export path is the one file path the model may see.
- **Sanitized everything.** Every display/log surface passes
  `sanitizeText`/`redactSecrets`; credentials and temp paths never leak.
- **Fail visibly.** Remote methods must exist for their descriptors (tested);
  interactive failures are written to the diagnostics log instead of vanishing
  into a tooltip.
- **Effect-owning lifecycles.** Every host registration rides the plugin fiber;
  client registrations ride the client plugin fiber and `$mount` owns the
  Remote namespace.
- **No dead features.** v0.5 removed microphone/STT, browser `<audio>`
  playback, the audio cache/projection, edge-tts, piper, the macOS `say` engine
  and the multi-field settings write-back. Do not reintroduce them without a
  product decision.

## Build and checks

`pnpm run build` (`scripts/prepare.mjs`) then `pnpm pack`; install with
`plugin_manager install_bundle` using the tarball under
`~/.dsh/local-plugins/` (hot reload; a client bundle change needs a page
refresh). Verification set:

```sh
pnpm run typecheck && pnpm run typecheck:ci && pnpm test && pnpm run lint \
  && pnpm run build && pnpm run verify:self-contained \
  && pnpm run verify:artifacts && pnpm run check:readmes \
  && pnpm run check:lockfile
```

## Docs

- Five READMEs (`README.md` is the source of truth; `check:readmes` enforces
  equal section counts and one shared configuration table).
- `cordis.patch.yml` documents every config key inline.
- License Apache-2.0; no third-party source is bundled (`THIRD_PARTY_NOTICES.md`).
