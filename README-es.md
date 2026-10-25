<div align="center">

# 🎙️ dsh-talk (android)

**Texto a voz en la nube de MiniMax para la compilación Android de DeepSeek
Harness: las respuestas del agente se leen en voz alta, la Web UI reproduce el
audio y dos botones junto al compositor cambian el modo automático/manual y leen
—o detienen— la última respuesta.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```

</div>

## Instalación

```sh
# canal git, rama android (el objetivo de este README)
dsh plugin --profile web add github:jamesylj/dsh-talk#android

# canal npm (versión publicada)
dsh plugin --profile web add dsh-talk

# canal tarball (compila esta rama primero)
pnpm pack && dsh plugin --profile web add ./dsh-talk-<version>.tgz
```

Desinstalar con `dsh plugin --profile web remove dsh-talk`.

## Qué hace

- **Herramienta `speak`** — el agente dice una respuesta mediante MiniMax `speech-2.8-turbo`.
- **Lectura automática** — al terminar un turno, la respuesta final del asistente
  se lee automáticamente (sin bloques de código, limitada por `autoReply.maxChars`).
- **Botón de reproducción junto al compositor** — un clic lee la respuesta más
  reciente del asistente en la sesión actual; vuelve a hacer clic mientras suena
  para detenerla.
- **Botón de modo junto al compositor** — alterna entre **auto** (las respuestas
  se leen automáticamente) y **manual** (el plugin guarda silencio hasta que
  pulses ▶). El cambio es estado en tiempo de ejecución: no escribe
  configuración ni recarga.
- **Anuncio de fin de turno** — una línea breve "Turn complete." cuando un turno
  terminado no se leyó automáticamente y no hay nada más sonando.

Esta rama es solo para Android por diseño: el motor local MLX Qwen3-TTS y el
reproductor `ffplay` del host de la línea `main` (macOS/Linux) ya no están. El
entorno Android no tiene ni MLX para Apple Silicon ni reproductor de audio en el
host, así que el host sintetiza el MP3 y la Web UI de DeepSeek Harness lo
reproduce en el WebView.

## Inicio rápido

1. Instala el plugin en la app DeepSeek Harness para Android (ver instalación en
   Android).
2. Configura la API key de MiniMax (`MINIMAX_CN_API_KEY` o el almacén de
   credenciales del harness). No hace falta instalar ningún otro motor.
3. Pide al agente que use `speak`, o simplemente envía un mensaje normal — la
   respuesta se lee al terminar el turno y la interfaz de chat la reproduce.
4. Usa la píldora auto/manual junto al compositor para cambiar el modo, y el
   botón ▶ / ⏹ para repetir o detener la última respuesta.

## Configuración

Todas las claves viven bajo el `config` de la fila `talk` en la capa de parche
del perfil. El `cordis.patch.yml` de este repositorio documenta cada clave en
línea.

| Clave | Por defecto | Significado |
|---|---|---|
| `tts.minimax.apiKeyEnv` / `tts.minimax.credentialsFile` | `MINIMAX_CN_API_KEY` / `~/.dsh/.credentials.yaml` | De dónde se lee la API key (primero el entorno y luego la sección `refs:` del almacén de credenciales del harness); la clave nunca se registra |
| `tts.minimax.baseUrl` / `tts.minimax.model` / `tts.minimax.voiceId` | `https://api.minimax.cn/v1/t2a_v2` / `speech-2.8-turbo` / `Chinese (Mandarin)_Warm_Girl` | Endpoint, id del modelo e id de la voz del sistema |
| `tts.minimax.chunkChars` / `tts.minimax.requestTimeoutMs` | `2000` / `120000` | Caracteres por petición a la API (el texto largo se divide en límites de frase y las piezas se concatenan) y el timeout de inactividad en milisegundos |
| `announce.enabled` | `true` | Leer la línea de fin de turno cuando un turno no se leyó automáticamente |
| `autoReply.enabled` / `autoReply.maxChars` | `true` / `600` | Lectura automática de la respuesta final y su límite de caracteres |
| `maxSpeakChars` | `20000` | Límite de una petición de la herramienta `speak` |

## Cómo funciona la reproducción

En esta rama no hay reproductor de audio en el host:

1. El host llama al endpoint T2A síncrono de MiniMax con `stream: true`,
   decodifica los fragmentos MP3 hexadecimales del flujo SSE, concatena los lotes
   de una misma locución y encola el MP3 (con límite: como máximo 6 locuciones /
   24 MiB).
2. La interfaz de chat consulta `talk/pending` con un cursor, decodifica cada MP3
   base64 en un Blob y lo reproduce a través de un único elemento `<audio>`
   compartido, una locución a la vez. El audio de la lectura automática llega por
   tanto al WebView, no desde un proceso local.
3. El botón ▶ llama a `talk/playLatest` con el id de la sesión actual; ⏹ detiene
   el elemento local y llama a `talk/stop`, que aborta la síntesis y vacía la
   cola. Una nueva locución solo interrumpe la **misma sesión**; la lectura
   automática y los anuncios usan `interrupt: false`, así que una lectura larga
   suena hasta el final.

El WebView de Android puede exigir un gesto del usuario antes de iniciar audio. El
primer toque en cualquier parte de la página desbloquea el reproductor; si aun así
se rechaza la reproducción, el tooltip del botón lo indica y el siguiente gesto
reintenta.

## Configuración de MiniMax

Pon la API key en el entorno con el que arrancas el harness, o déjala en el
almacén de credenciales del harness (`refs:` en `~/.dsh/.credentials.yaml`):

```sh
export MINIMAX_CN_API_KEY=...
```

Voces mandarinas habituales: `Chinese (Mandarin)_Warm_Girl`, `female-yujie`,
`Chinese (Mandarin)_Gentleman`, `Chinese (Mandarin)_News_Anchor`. El precio es de
unos ¥2 por 10 000 caracteres (un carácter chino cuenta como dos). El texto
hablado sale del dispositivo y se factura por carácter.

## Instalación en Android

1. Instala [DeepSeek Harness para Android](https://github.com/woaiys3/deepseek-harness-android-app)
   (kernel `0.2.1-rc.2`; la línea peer de esta rama coincide con él).
2. En la app: 控制台 →「插件」, instala desde la dirección de GitHub
   `github:jamesylj/dsh-talk#android` (la app incluye pnpm y git), o copia un
   tarball compilado al dispositivo e instálalo desde un directorio local.
3. Añade la fila `talk` a la capa de parche del perfil si el bundle no la inserta,
   luego arranca el motor y rellena la API key.
4. Abre una conversación: los dos botones aparecen a la izquierda del compositor.

El plugin solo necesita acceso de red saliente; no lanza ningún proceso local.

## Botón de reproducción, botón de modo y ajustes

La píldora de modo en `conversation.input.left` muestra `Auto` o `Manual`:

- **Auto** — cada respuesta terminada se lee en voz alta (sujeta a
  `autoReply.enabled`, a los motivos de fin de turno y a `announce.enabled`).
- **Manual** — el host queda completamente en silencio tras un turno; solo habla
  el botón ▶. Un clic cambia al otro modo de inmediato mediante `talk/applyMode`.

El botón ▶ / ⏹ de al lado muestra ▶ cuando está inactivo y ⏹ mientras hay audio
sonando o sintetizándose. El modo es estado de ejecución: al reiniciar se vuelve
al valor configurado de `autoReply.enabled`, y el interruptor de lectura
automática de la pestaña de ajustes refleja el modo actual y lo persiste. La
pestaña de ajustes también expone el id de voz de MiniMax; guardar añade una
operación de fila a la capa de parche del perfil (recarga para aplicarla).

## Solución de problemas

- **Sin sonido**: falta la API key de MiniMax (`minimax: no API key`), el teléfono
  está sin conexión, o el WebView sigue esperando un gesto del usuario — toca una
  vez en cualquier sitio y pulsa ▶.
- **Errores de autenticación**: `minimax: 1004: invalid api key` significa que la
  clave no se encontró ni en el entorno ni en el almacén de credenciales.
- **Un botón del compositor parece no hacer nada**: revisa el log de diagnóstico
  acotado en `~/.dsh-talk/logs/diagnostics.log` — allí se registran las llamadas
  de reproducción/parada fallidas (credenciales censuradas).
- **Una lectura larga se corta**: busca `interrupted` en el log de la sesión; la
  cola conserva como máximo 6 locuciones / 24 MiB y una locución de más de
  16 MiB de MP3 falla con un error de motor claro.

## Seguridad y desarrollo

- La API key se resuelve por locución y nunca se registra; el texto de error se
  sanea antes de llegar al log de la sesión o al resultado de la herramienta.
- Cada locución se registra como un evento de sesión `plugin:dsh-talk/speech`
  (texto, motor, motivo, número de bytes, error) — sin bytes de audio en el log.
- El audio sintetizado solo cruza el canal Remote local, nunca se escribe en
  disco y se descarta de la cola tras la reproducción o al pulsar ⏹.
- Los fallos interactivos añaden una línea acotada y con secretos censurados a
  `~/.dsh-talk/logs/diagnostics.log`.
- Comprobaciones: `pnpm run typecheck && pnpm run typecheck:ci && pnpm test &&
  pnpm run build && pnpm run verify:self-contained && pnpm run verify:artifacts
  && pnpm run check:readmes && pnpm run check:lockfile`.

## Licencia

Apache-2.0.
