# Install dsh-talk directly from GitHub · 直接从 GitHub 路径安装

This repository is a DeepSeek Harness plugin bundle that can be installed **from
its GitHub path alone** — no npm publish, no registry mirror needed. It carries
two independent lines:

本仓库是 DeepSeek Harness 插件 bundle，可以**只凭 GitHub 地址**安装——不需要 npm
发布、不需要镜像源。仓库里有两条互相独立的线：

| Line | GitHub path | Version / tag | Platform |
|---|---|---|---|
| `main` — host-played TTS (MiniMax + local MLX) | `github:jamesylj/dsh-talk#v0.5.3` (or `#main`) | `v0.5.3` | macOS / Linux |
| `android` — MiniMax only, Web UI playback | `github:jamesylj/dsh-talk#v0.6.0-android.1` (or `#android`) | `v0.6.0-android.1` | Android (DSH Android app) |

Only **one line per profile**: both install the same package name (`dsh-talk`),
so installing one replaces the other.

同一个 profile 只能装一条线：两条线包名都是 `dsh-talk`，装一条会替换另一条。

## DSH Desktop (Windows / macOS / Linux)

1. Sidebar → **Plugins** / 侧栏 →「插件」→ **Add plugin** /「添加插件」.
2. **Package name or address** /「包名或地址」 enter one of:
   - `github:jamesylj/dsh-talk#v0.5.3` — desktop line
   - `github:jamesylj/dsh-talk#v0.6.0-android.1` — Android line (only useful on the
     DSH Android app; desktop has a working host player, so use the desktop line)
3. Click **Install** /「安装」, then **Enable** /「立即启用」; fully quit and reopen
   DSH if it says the change takes effect next launch.

Requirements and the one extra step:

- **Git must be installed** — DSH fetches a git spec with pnpm's git channel.
- This repo is TypeScript: pnpm must run the package's `prepare` script once to
  build `lib/`. DSH surfaces that as a pending build (`dsh-talk`); if the install
  reports that install scripts need approval, approve them (allow running
  `dsh-talk` build scripts) and retry. In the DSH Desktop plugin page this is the
  usual "allow build scripts" prompt; via the plugin-manager API it is
  `pendingBuilds: ["dsh-talk"]` → pass it as `approvedBuilds`.

要求与唯一的多余步骤：

- **本机要装 Git**（DSH 用 pnpm 的 git 通道拉取）。
- 本仓库是 TypeScript：pnpm 必须运行一次 `prepare` 构建 `lib/`。DSH 会把它显示为
  待批准的构建（`dsh-talk`）；如果安装提示需要允许安装脚本，允许 `dsh-talk`
  运行构建脚本后重试。桌面插件页就是常见的"允许构建脚本"确认；用插件管理 API
  时对应 `pendingBuilds: ["dsh-talk"]` → 作为 `approvedBuilds` 传入。

## dsh Web (CLI)

Requires Node.js 22.19+ and pnpm; install Git as well.

```sh
# desktop line
npx @deepseek-ai/dsh@0.2.1-rc.3 plugin --profile web add github:jamesylj/dsh-talk#v0.5.3
npx @deepseek-ai/dsh@0.2.1-rc.3 web

# android line (on an Android/DSH app host that exposes the CLI)
npx @deepseek-ai/dsh@0.2.1-rc.3 plugin --profile web add github:jamesylj/dsh-talk#android
```

## DSH Android app

控制台 →「插件」→ 包名或地址填：

```
github:jamesylj/dsh-talk#android
```

或固定版本 `github:jamesylj/dsh-talk#v0.6.0-android.1`。App 自带 pnpm 与 git，
无需额外安装；如提示允许安装脚本，允许 `dsh-talk` 后重试。装好后按
[README-zh.md](../README-zh.md#安卓安装) 填 MiniMax API Key。

## Pin a tag or follow a branch

- **Tag (`#v0.5.3`, `#v0.6.0-android.1`)** — reproducible; use this in docs and
  long-lived profiles.
- **Branch (`#main`, `#android`)** — latest development commit of that line.

升级：把地址里的 tag 改成新版本，或删掉插件重新添加；会话数据不在插件目录里，
重装不会删数据。

## If build scripts cannot be allowed

Use a prebuilt artifact instead of the git channel:

1. GitHub [Releases](https://github.com/jamesylj/dsh-talk/releases) attach
   `dsh-talk-0.5.3.tgz` and `dsh-talk-0.6.0-android.1.tgz`; download the one for
   your line and give DSH the file path.
2. Or build locally (`pnpm install && pnpm pack`) and install the tarball.
3. Or install from a local directory (`git clone`, then point DSH at the folder).

If the git channel works, you never need these.
