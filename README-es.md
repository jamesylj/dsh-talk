<div align="center">

# 🎙️ dsh-talk

**Texto a voz en el host para DeepSeek Harness: las respuestas del agente se leen
en voz alta y un botón junto al compositor lee o detiene la última respuesta.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-talk)](https://www.npmjs.com/package/dsh-talk)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```

</div>

## Instalación

```sh
dsh plugin --profile web add github:PerryLink/dsh-talk
dsh plugin --profile web add dsh-talk
pnpm pack && dsh plugin --profile web add ./dsh-talk-<version>.tgz
```

Desinstalar: `dsh plugin --profile web remove dsh-talk`.

## Qué hace

- **Herramienta `speak`**: el agente habla en la máquina host.
- **Lectura automática**: al terminar un turno se lee la última respuesta del
  asistente (sin bloques de código, limitada por `autoReply.maxChars`).
- **Botón de reproducción**: un clic lee la última respuesta de la sesión
  actual; otro clic mientras suena la detiene.
- **Anuncio de fin de turno**: una línea breve cuando el turno no se leyó y no
  hay audio en curso.
- **Exportación de audio opcional** (desactivada por defecto).

La entrada de voz, la reproducción `<audio>` del navegador, edge-tts, piper, la
voz `say` de macOS y la escritura de ajustes de 0.4 se eliminaron en 0.5.

## Inicio rápido

1. Instala el bundle y reinicia el perfil.
2. Configura un motor: MiniMax por defecto (necesita API key), MLX como
   respaldo local.
3. Pide al agente que use `speak` o envía un mensaje normal: la respuesta se lee
   al terminar el turno.
4. Usa ▶ / ⏹ para repetir o detener la última respuesta.

MiniMax necesita `ffplay` (Homebrew `ffmpeg`): `brew install ffmpeg`.

## Configuración

| Clave | Por defecto | Significado |
|---|---|---|
| `tts.engine` / `tts.fallback` | `minimax` / `true` | Motor (`minimax` o `mlx`); si MiniMax falla se reintenta con MLX cuando hay WAV de referencia |
| `tts.minimax.apiKeyEnv` / `tts.minimax.credentialsFile` | `MINIMAX_CN_API_KEY` / `~/.dsh/.credentials.yaml` | Origen de la API key: entorno y luego el almacén de credenciales del harness (`refs:`); nunca se registra |
| `tts.minimax.baseUrl` / `tts.minimax.model` / `tts.minimax.voiceId` | `https://api.minimax.cn/v1/t2a_v2` / `speech-2.8-turbo` / `Chinese (Mandarin)_Warm_Girl` | Endpoint, modelo y voz del sistema |
| `tts.minimax.player` / `tts.minimax.chunkChars` / `tts.minimax.requestTimeoutMs` | `ffplay` / `2000` / `120000` | Reproductor, caracteres por petición y timeout de inactividad en ms |
| `tts.mlx.command` / `tts.mlx.script` / `tts.mlx.model` / `tts.mlx.refAudio` | python del venv / worker incluido / modelo Base 4-bit / *(ninguno)* | Motor local Qwen3-TTS Base con clonación x-vector |
| `tts.export.enabled` / `tts.export.dir` | `false` / `<home>/.dsh-talk/audio` | Escribe el audio en un archivo y devuelve `audioPath` |
| `announce.enabled` | `true` | Anuncio de fin de turno cuando no hubo lectura automática |
| `autoReply.enabled` / `autoReply.maxChars` | `true` / `600` | Lectura automática y su límite de caracteres |
| `maxSpeakChars` | `20000` | Límite de una llamada a `speak` |

## Motor de reproducción

- **MiniMax**: se llama al T2A síncrono con `stream: true`; los fragmentos MP3
  del SSE se escriben directamente en el stdin de un único `ffplay`.
- **MLX**: un worker residente mantiene el modelo Qwen3-TTS **Base** caliente y
  clona la voz de `tts.mlx.refAudio` solo con x-vector (sin voz predefinida ni
  ICL). Los fragmentos van a un único flujo `sounddevice`.
- Una lectura nueva solo interrumpe la de la **misma sesión**; la lectura
  automática y los anuncios usan `interrupt: false`.
- El botón usa `talk/playLatest` y `talk/stop`.

## Configuración de MiniMax

```sh
export MINIMAX_CN_API_KEY=...
```

Voces: `Chinese (Mandarin)_Warm_Girl`, `female-yujie`,
`Chinese (Mandarin)_Gentleman`. Precio aproximado ¥2 por 10 000 caracteres (un
carácter chino cuenta como dos); el texto sale de la máquina.

## Configuración de MLX

1. Crea un venv con `mlx-audio` en `~/.dsh-talk/mlx-tts-venv`.
2. Descarga un checkpoint Qwen3-TTS **Base** 4-bit en
   `~/.dsh-talk/models/qwen3-tts-0.6b-base-4bit`.
3. Crea un WAV de referencia y apunta `tts.mlx.refAudio` a él.

## Botón y ajustes

El botón muestra ▶ en reposo y ⏹ mientras habla. La pestaña de ajustes ofrece
motor, voz de MiniMax y el interruptor de lectura automática; guardar añade una
operación al patch del perfil (recarga para aplicar).

## Solución de problemas

- Sin sonido: falta `ffplay` ( `brew install ffmpeg` ) o la API key; el evento
  `plugin:dsh-talk/speech` registra el `error`.
- `minimax: 1004: invalid api key`: la clave no está en el entorno ni en el
  almacén.
- MLX lento la primera vez: carga el modelo; después reutiliza el worker.

## Seguridad y desarrollo

- La API key se resuelve por locución y nunca se registra.
- Cada locución se anota como evento `plugin:dsh-talk/speech` sin bytes de audio.
- Comprobaciones: `pnpm test`, `pnpm run build`, `pnpm run check:readmes`.

## Licencia

Apache-2.0.
