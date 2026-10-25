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
| `@deepseek-ai/dsh-*` peers | `>=0.2.1-0 <0.3.0` | See packages | Official harness seams (`dsh-tools`, `dsh-session`, `dsh-typert-protocol`, `dsh-api-remotes`, client slot/locale/settings packages) |

## Runtime services the user configures

The plugin bundles no audio player and no speech model. It calls exactly one
external service and relies on the app's own WebView for playback:

| Component | Role | Notes |
|---|---|---|
| MiniMax T2A API (`speech-2.8-turbo`) | Cloud speech synthesis | The spoken text leaves the device and is billed per character under MiniMax's terms; the API key is resolved from the environment or the harness credential store and is never logged |
| Android WebView (`<audio>`, Blob URL) | Plays the synthesized MP3 in the chat UI | Part of the DeepSeek Harness Android app; the plugin only hands it base64 MP3 over the local Remote channel and never loads a third-party player |
| DeepSeek Harness Android app (kernel `0.2.1-rc.2`) | Host runtime and UI | Distributed by its own project (MIT); this plugin is a bundle installed on top of it |
