# Third-party notices

`dsh-talk` bundles no third-party source code. All TypeScript sources in this
repository are original works by the dsh-talk contributors, licensed under
Apache-2.0 (see `LICENSE`).

## Build and install dependencies

None of these are vendored into the published tarball; they are resolved at
install/build time.

| Package | Version range | License | Purpose |
|---|---|---|---|
| [tsdown](https://github.com/rolldown/tsdown) | `^0.23.1` | MIT | Build-time bundling of `lib/` (a regular dependency so the git-install channel's `prepare` script can build) |
| [typescript](https://github.com/microsoft/TypeScript) | `^7.0.0` | Apache-2.0 | Build-time declaration emission (`lib/types/`) |
| [zod](https://github.com/colinhacks/zod) | `4.4.3` | MIT | Wire schemas for the `talk` Remote namespace (inlined into both build halves) |
| [@deepseek-ai/cordis](https://www.npmjs.com/package/@deepseek-ai/cordis) | `^4.0.5-alpha.1` (peer) | See package | The plugin runtime |
| [@deepseek-ai/schemastery](https://www.npmjs.com/package/@deepseek-ai/schemastery) | `^3.18.5` (peer) | See package | Configuration schema |
| `@deepseek-ai/dsh-*` peers | `>=0.2.1-0 <0.3.0` | See packages | Official harness seams (`dsh-tools`, `dsh-session`, `dsh-subprocess`, `dsh-typert-protocol`, `dsh-api-remotes`, client slot/locale/settings packages) |

## Runtime services the user configures

These are not bundled or installed by this package; the plugin calls them only
when they are configured:

| Component | Role | Notes |
|---|---|---|
| MiniMax T2A API (`speech-2.8-turbo`) | Cloud speech synthesis | The spoken text leaves the machine and is billed per character under MiniMax's terms; the API key is resolved from the environment or the harness credential store and is never logged |
| `ffplay` (Homebrew `ffmpeg`) | Streams the MiniMax MP3 response from stdin | Never receives text; only audio bytes |
| Python venv with `mlx-audio` / `sounddevice` + a Qwen3-TTS **Base** 4-bit MLX checkpoint | Offline MLX clone synthesis and playback | Model weights are downloaded by the user; this repository ships only `worker/mlx_tts.py` |
| Reference WAV (`tts.mlx.refAudio`) | x-vector clone reference for the MLX engine | User-supplied audio; read locally, never uploaded by the plugin |

The MiniMax service terms, the ffmpeg license, and the MLX model license belong
to their respective providers.
