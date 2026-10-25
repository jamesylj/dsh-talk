<div align="center">

# 🎙️ dsh-talk (android)

**DeepSeek Harness 安卓版的 MiniMax 云端语音朗读：助手回复自动念出来，由 Web UI
播放；输入框旁两个按钮分别切换自动/手动模式、手动朗读或中途停止。**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-talk)](https://www.npmjs.com/package/dsh-talk)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```

</div>

## 安装

```sh
# git 渠道，android 分支（本 README 对应的分支）
dsh plugin --profile web add github:jamesylj/dsh-talk#android

# npm 渠道（发布版）
dsh plugin --profile web add dsh-talk

# tarball 渠道（先在本分支执行构建）
pnpm pack && dsh plugin --profile web add ./dsh-talk-<version>.tgz
```

卸载：`dsh plugin --profile web remove dsh-talk`。

**直接走 GitHub 路径（不需要 npm）：** DSH 桌面版「插件 → 添加插件」、`dsh plugin`
命令行和安卓 App 的控制台「插件」页都接受
`github:jamesylj/dsh-talk#v0.6.0-android.1`（跟随最新提交用 `#android`）。需要本机装
Git，并允许一次构建脚本（`dsh-talk`）。桌面线用
`github:jamesylj/dsh-talk#v0.5.3`。完整步骤见
[docs/install-github.md](docs/install-github.md)。

## 功能

- **`speak` 工具**：助手通过 MiniMax `speech-2.8-turbo` 朗读回复。
- **自动朗读**：回合结束时自动念出最后一条助手回复（去掉代码块，长度受 `autoReply.maxChars` 限制）。
- **输入框播放按钮**：单击朗读当前会话最近一条回复；播放中单击立即停止。
- **输入框模式按钮**：在 **自动**（回合结束自动朗读）和 **手动**（插件保持安静，只有点 ▶ 才播报）之间切换；纯运行时状态，不写配置、不需重载。
- **回合结束播报**：没有自动朗读且当前没有播放时，补一句 “Turn complete.”。

本分支是安卓专用：`main` 线（macOS/Linux）的本地 MLX Qwen3-TTS 引擎和宿主端
`ffplay` 播放器都已移除。安卓运行时既没有 Apple 芯片的 MLX，也没有宿主播放器，
因此由宿主合成 MP3，再由 DeepSeek Harness Web UI 在 WebView 里播放。

## 快速开始

1. 把插件装进安卓版 DeepSeek Harness（见「安卓安装」）。
2. 配置 MiniMax API Key（`MINIMAX_CN_API_KEY` 或 harness 凭据库），无需安装任何本地引擎。
3. 让助手调用 `speak`，或直接正常对话——回合结束会自动朗读，聊天界面负责播放。
4. 用输入框旁的「自动/手动」按钮切换模式，用 ▶ / ⏹ 按钮重播或停止最近回复。

## 配置

所有键位于 profile patch 层 `talk` 行的 `config` 下；仓库内 `cordis.patch.yml` 逐项注释。

| 键 | 默认值 | 说明 |
|---|---|---|
| `tts.minimax.apiKeyEnv` / `tts.minimax.credentialsFile` | `MINIMAX_CN_API_KEY` / `~/.dsh/.credentials.yaml` | API Key 来源：先环境变量，再 harness 凭据库 `refs:`；密钥不会写日志 |
| `tts.minimax.baseUrl` / `tts.minimax.model` / `tts.minimax.voiceId` | `https://api.minimax.cn/v1/t2a_v2` / `speech-2.8-turbo` / `Chinese (Mandarin)_Warm_Girl` | 接口地址、模型、系统音色 |
| `tts.minimax.chunkChars` / `tts.minimax.requestTimeoutMs` | `2000` / `120000` | 每请求字符数（超长按句切分后拼接）与空闲超时（毫秒） |
| `announce.enabled` | `true` | 未自动朗读时是否播报回合结束 |
| `autoReply.enabled` / `autoReply.maxChars` | `true` / `600` | 自动朗读开关与字符上限 |
| `maxSpeakChars` | `20000` | 单次 `speak` 文本上限 |

## 播放机制

本分支没有宿主播放器：

1. 宿主调用同步 MiniMax T2A 接口（`stream: true`），解码 SSE 里的十六进制 MP3
   分片，把同一条朗读的多批音频拼接后放入队列（上限：6 条 / 24 MiB）。
2. 聊天界面用游标轮询 `talk/pending`，把 base64 MP3 解成 Blob，通过同一个共享
   `<audio>` 元素逐条播放——自动朗读的声音也因此从 WebView 发出，而不是本机进程。
3. ▶ 按钮用当前会话 id 调 `talk/playLatest`；⏹ 停止本地播放并调 `talk/stop`，
   同时中止合成、清空队列。新的朗读只会打断**同一会话**；自动朗读与播报传
   `interrupt: false`，长文可以完整读完。

安卓 WebView 可能要求先有用户手势才允许播放：在页面任意处点一下即可解锁；
若仍被拒绝，按钮提示会说明，下一次手势会自动重试。

## MiniMax 配置

API Key 放在启动 harness 的环境变量中，或 harness 凭据库（`~/.dsh/.credentials.yaml` 的 `refs:`）：

```sh
export MINIMAX_CN_API_KEY=...
```

常用中文音色：`Chinese (Mandarin)_Warm_Girl`、`female-yujie`、`Chinese (Mandarin)_Gentleman`、`Chinese (Mandarin)_News_Anchor`。价格约 ¥2/万字符（1 个汉字算 2 字符）；朗读文本会离开本机并按字符计费。

## 安卓安装

1. 先安装 [DeepSeek Harness 安卓版](https://github.com/woaiys3/deepseek-harness-android-app)
   （内核 `0.2.1-rc.2`，与本分支的 peer 线一致）。
2. 在 App 里：控制台 →「插件」，用 GitHub 地址 `github:jamesylj/dsh-talk#android`
   安装（App 自带 pnpm 与 git），或把构建好的 tarball 拷到手机后从本地目录安装。
3. 若 bundle 没有自动插入 `talk` 行，请在 profile patch 层手动添加，然后启动引擎并填写 API Key。
4. 打开一个会话：输入框左侧会出现两个按钮。

插件只需要出站网络权限，不启动任何本地进程。

## 按钮与设置

输入框左侧的模式按钮显示「自动」或「手动」：

- **自动**：回合结束后自动朗读回复（仍受 `autoReply.enabled`、回合结束原因和 `announce.enabled` 约束）。
- **手动**：回合结束后宿主完全不发声，只有点 ▶ 按钮才朗读；单击按钮会立即通过 `talk/applyMode` 切到另一种模式。

旁边的 ▶ / ⏹ 按钮空闲时显示 ▶，播放中或合成中显示 ⏹。模式是运行时状态，重启后回到配置里的 `autoReply.enabled` 默认值；设置面板的自动朗读开关会显示当前模式，保存后即成为新的默认值。设置面板还提供 MiniMax 音色 ID；保存会向 profile patch 追加一条操作（重载后生效）。

## 故障排查

- **没有声音**：缺少 MiniMax API Key（`minimax: no API key`）、手机离线，或 WebView 还在等用户手势——先在页面点一下，再按 ▶。
- **鉴权错误**：`minimax: 1004: invalid api key` 表示环境变量和凭据库都没找到 Key。
- **点按钮没反应**：查看 `~/.dsh-talk/logs/diagnostics.log`（有界、只保留一份历史、凭据已脱敏），失败的播放/停止调用会记录在那。
- **长文被截断**：会话日志里看 `interrupted`；队列最多保留 6 条 / 24 MiB，单条 MP3 超过 16 MiB 会以明确的引擎错误失败。

## 安全与开发

- API Key 按次解析、从不写日志；错误文本在进入会话日志或工具结果前会脱敏。
- 每次朗读都会追加 `plugin:dsh-talk/speech` 会话事件（文本、引擎、原因、字节数、错误），不存音频字节。
- 合成音频只走本机 Remote 通道，不落盘，播放完或按 ⏹ 后即从队列丢弃。
- 交互类失败会向 `~/.dsh-talk/logs/diagnostics.log` 追加有界、脱敏的一行。
- 检查命令：`pnpm run typecheck && pnpm run typecheck:ci && pnpm test && pnpm run build && pnpm run verify:self-contained && pnpm run verify:artifacts && pnpm run check:readmes && pnpm run check:lockfile`。

## 许可证

Apache-2.0。
