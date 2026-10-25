<div align="center">

# 🎙️ dsh-talk

**DeepSeek Harness 的宿主端语音朗读：助手回复自动念出来，输入框旁一个按钮可以手动朗读或中途停止。**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-talk)](https://www.npmjs.com/package/dsh-talk)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```

</div>

## 安装

```sh
dsh plugin --profile web add github:jamesylj/dsh-talk   # git 渠道
dsh plugin --profile web add dsh-talk                      # npm 渠道
pnpm pack && dsh plugin --profile web add ./dsh-talk-<version>.tgz  # tarball
```

卸载：`dsh plugin --profile web remove dsh-talk`。

## 功能

- **`speak` 工具**：助手在宿主机器上朗读回复。
- **自动朗读**：回合结束时自动念出最后一条助手回复（去掉代码块，长度受 `autoReply.maxChars` 限制）。
- **输入框播放按钮**：单击朗读当前会话最近一条回复；播放中单击立即停止。
- **回合结束播报**：没有自动朗读且当前没有播放时，补一句 “Turn complete.”。
- **可选音频导出**：把宿主合成的音频写入文件并通过 `audioPath` 返回（默认关闭）。

0.5 移除了麦克风/STT、浏览器 `<audio>` 播放、edge-tts、piper、macOS `say` 和设置写回：剩下的两个引擎都在宿主播放，客户端不再需要投影与音频缓存。

## 快速开始

1. 安装并重启 profile。
2. 配置引擎：MiniMax 为默认（需要 API Key）；MLX 作为离线克隆回退。
3. 让助手调用 `speak`，或直接正常对话——回合结束会自动朗读。
4. 用输入框旁的 ▶ / ⏹ 按钮重播或停止最近回复。

MiniMax 播放依赖 `ffplay`（Homebrew `ffmpeg`）：`brew install ffmpeg`。

## 配置

所有键位于 profile patch 层 `talk` 行的 `config` 下；仓库内 `cordis.patch.yml` 逐项注释。

| 键 | 默认值 | 说明 |
|---|---|---|
| `tts.engine` / `tts.fallback` | `minimax` / `true` | 引擎（`minimax` 或 `mlx`）；MiniMax 失败且配置了参考音频时回退 MLX |
| `tts.minimax.apiKeyEnv` / `tts.minimax.credentialsFile` | `MINIMAX_CN_API_KEY` / `~/.dsh/.credentials.yaml` | API Key 来源：先环境变量，再 harness 凭据库 `refs:`；密钥不会写日志 |
| `tts.minimax.baseUrl` / `tts.minimax.model` / `tts.minimax.voiceId` | `https://api.minimax.cn/v1/t2a_v2` / `speech-2.8-turbo` / `Chinese (Mandarin)_Warm_Girl` | 接口地址、模型、系统音色 |
| `tts.minimax.player` / `tts.minimax.chunkChars` / `tts.minimax.requestTimeoutMs` | `ffplay` / `2000` / `120000` | 播放器、每请求字符数（超长按句切分）、空闲超时（毫秒） |
| `tts.mlx.command` / `tts.mlx.script` / `tts.mlx.model` / `tts.mlx.refAudio` | venv python / 内置 worker / Base 4bit 模型 / *(无)* | 本地 Qwen3-TTS Base 克隆：解释器、worker、模型目录、x-vector 参考 WAV |
| `tts.export.enabled` / `tts.export.dir` | `false` / `<home>/.dsh-talk/audio` | 把宿主合成音频写入文件并返回 `audioPath` |
| `announce.enabled` | `true` | 未自动朗读时是否播报回合结束 |
| `autoReply.enabled` / `autoReply.maxChars` | `true` / `600` | 自动朗读开关与字符上限 |
| `maxSpeakChars` | `20000` | 单次 `speak` 文本上限 |

## 宿主播放引擎

- **MiniMax**（`speech-2.8-turbo`）：调用同步 T2A 接口（`stream: true`），SSE 的十六进制 MP3 分片直接写入一个 `ffplay` 进程的 stdin。首音几百毫秒内开始，长文本是一条连续音频流；超过 `tts.minimax.chunkChars` 的文本按句切分但仍是同一个播放器。
- **MLX**（离线）：常驻 Python worker 保持量化 Qwen3-TTS **Base** 模型热加载，只用 x-vector 克隆 `tts.mlx.refAudio`（无预设音色、无 ICL 参考文本），片段写入同一条 `sounddevice` 输出流。
- 新的朗读只会打断**同一会话**正在播放的内容；自动朗读与播报传 `interrupt: false`，长文可以完整读完。
- 输入框按钮通过同一管线朗读最近回复，并用 `talk/stop` 停止。

## MiniMax 配置

API Key 放在启动 harness 的环境变量中，或 harness 凭据库（`~/.dsh/.credentials.yaml` 的 `refs:`）：

```sh
export MINIMAX_CN_API_KEY=...
```

常用中文音色：`Chinese (Mandarin)_Warm_Girl`、`female-yujie`、`Chinese (Mandarin)_Gentleman`、`Chinese (Mandarin)_News_Anchor`。价格约 ¥2/万字符（1 个汉字算 2 字符）；朗读文本会离开本机并按字符计费。

## MLX 克隆配置

1. 在 `~/.dsh-talk/mlx-tts-venv` 建好带 `mlx-audio` 的 Python venv。
2. 下载 Qwen3-TTS **Base** 4bit MLX 模型到 `~/.dsh-talk/models/qwen3-tts-0.6b-base-4bit`。
3. 生成参考 WAV（例如 `say -v "Lilian (Premium)" -o ~/.dsh-talk/voices/lilian-ref.wav --file-format=WAVE --data-format=LEI16@24000 -f -`），并设置 `tts.mlx.refAudio`。

然后把 `tts.engine` 设为 `mlx`，或保持 `minimax` 并依赖 `tts.fallback: true` 在云端失败时回退。

## 按钮与设置

输入框左侧按钮空闲时显示 ▶、播放中显示 ⏹：单击分别调用 `talk/playLatest`（当前会话）和 `talk/stop`。设置面板提供引擎、MiniMax 音色和自动朗读开关，保存会向 profile patch 追加一条操作（重载后生效）。

## 故障排查

- **MiniMax 没声音**：缺少 `ffplay`（`brew install ffmpeg`）或没有 API Key；speak 结果和 `plugin:dsh-talk/speech` 事件会带 `error`。
- **鉴权错误**：`minimax: 1004: invalid api key` 表示环境变量和凭据库都没找到 Key。
- **MLX 首次很慢**：第一次请求要加载模型，之后复用常驻 worker。
- **长文被截断**：会话日志里看 `interrupted`；同一会话的新朗读会抢占当前朗读。

## 安全与开发

- API Key 按次解析、从不写日志；错误文本在进入会话日志或工具结果前会脱敏。
- 每次朗读都会追加 `plugin:dsh-talk/speech` 会话事件（文本、引擎、原因、字节数、错误），不存音频字节。
- 检查命令：`pnpm run typecheck && pnpm run typecheck:ci && pnpm test && pnpm run build && pnpm run verify:self-contained && pnpm run verify:artifacts && pnpm run check:readmes && pnpm run check:lockfile`。

## 许可证

Apache-2.0。
