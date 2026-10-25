<div align="center">

# 🎙️ dsh-talk

**Texto em voz no host para o DeepSeek Harness: as respostas do agente são lidas
em voz alta e dois botões ao lado do compositor alternam o modo automático/manual
e leem ou interrompem a última resposta.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-talk)](https://www.npmjs.com/package/dsh-talk)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```

</div>

## Instalação

```sh
dsh plugin --profile web add github:jamesylj/dsh-talk
dsh plugin --profile web add dsh-talk
pnpm pack && dsh plugin --profile web add ./dsh-talk-<version>.tgz
```

Remover: `dsh plugin --profile web remove dsh-talk`.

## O que faz

- **Ferramenta `speak`**: o agente fala na máquina host.
- **Leitura automática**: ao fim de um turno a última resposta do assistente é
  lida (sem blocos de código, limitada por `autoReply.maxChars`).
- **Botão de reprodução**: um clique lê a última resposta da sessão atual; outro
  clique enquanto toca interrompe.
- **Botão de modo**: alterna **auto** (leitura automática ao fim do turno) e
  **manual** (o host fica em silêncio até você clicar em ▶). É estado de
  execução: não grava configuração nem exige recarregar.
- **Anúncio de fim de turno**: uma linha curta quando o turno não foi lido e não
  há áudio em andamento.
- **Exportação de áudio opcional** (desativada por padrão).

Entrada de voz, reprodução `<audio>` no navegador, edge-tts, piper, a voz `say`
do macOS e a gravação de ajustes da 0.4 foram removidas na 0.5.

## Início rápido

1. Instale o bundle e reinicie o perfil.
2. Configure um motor: MiniMax por padrão (precisa de API key), MLX como
   fallback local.
3. Peça ao agente para usar `speak` ou envie uma mensagem normal — a resposta é
   lida ao terminar o turno.
4. Use o botão de modo para alternar auto/manual e ▶ / ⏹ para repetir ou parar
   a última resposta.

MiniMax precisa de `ffplay` (Homebrew `ffmpeg`): `brew install ffmpeg`.

## Configuração

| Chave | Padrão | Significado |
|---|---|---|
| `tts.engine` / `tts.fallback` | `minimax` / `true` | Motor (`minimax` ou `mlx`); se MiniMax falhar, tenta MLX quando há WAV de referência |
| `tts.minimax.apiKeyEnv` / `tts.minimax.credentialsFile` | `MINIMAX_CN_API_KEY` / `~/.dsh/.credentials.yaml` | Origem da API key: ambiente e depois o armazenamento de credenciais do harness (`refs:`); nunca é registrada |
| `tts.minimax.baseUrl` / `tts.minimax.model` / `tts.minimax.voiceId` | `https://api.minimax.cn/v1/t2a_v2` / `speech-2.8-turbo` / `Chinese (Mandarin)_Warm_Girl` | Endpoint, modelo e voz do sistema |
| `tts.minimax.player` / `tts.minimax.chunkChars` / `tts.minimax.requestTimeoutMs` | `ffplay` / `2000` / `120000` | Player, caracteres por requisição e timeout de inatividade em ms |
| `tts.mlx.command` / `tts.mlx.script` / `tts.mlx.model` / `tts.mlx.refAudio` | python do venv / worker incluído / modelo Base 4-bit / *(nenhum)* | Motor local Qwen3-TTS Base com clonagem x-vector |
| `tts.export.enabled` / `tts.export.dir` | `false` / `<home>/.dsh-talk/audio` | Grava o áudio em arquivo e devolve `audioPath` |
| `announce.enabled` | `true` | Anúncio de fim de turno quando não houve leitura automática |
| `autoReply.enabled` / `autoReply.maxChars` | `true` / `600` | Leitura automática e seu limite de caracteres |
| `maxSpeakChars` | `20000` | Limite de uma chamada `speak` |

## Motor de reprodução

- **MiniMax**: chama o T2A síncrono com `stream: true`; os fragmentos MP3 do SSE
  vão direto para o stdin de um único `ffplay`.
- **MLX**: um worker residente mantém o modelo Qwen3-TTS **Base** aquecido e
  clona a voz de `tts.mlx.refAudio` apenas com x-vector (sem voz predefinida nem
  ICL). Os fragmentos entram num único fluxo `sounddevice`.
- Uma nova leitura só interrompe a da **mesma sessão**; leitura automática e
  anúncios usam `interrupt: false`.
- O botão ▶ usa `talk/playLatest` e `talk/stop`; o botão de modo só troca o
  modo, então ▶ continua funcionando no manual.

## Configuração do MiniMax

```sh
export MINIMAX_CN_API_KEY=...
```

Vozes: `Chinese (Mandarin)_Warm_Girl`, `female-yujie`,
`Chinese (Mandarin)_Gentleman`. Preço aproximado ¥2 por 10 000 caracteres (um
caractere chinês conta como dois); o texto sai da máquina.

## Configuração do MLX

1. Crie um venv com `mlx-audio` em `~/.dsh-talk/mlx-tts-venv`.
2. Baixe um checkpoint Qwen3-TTS **Base** 4-bit em
   `~/.dsh-talk/models/qwen3-tts-0.6b-base-4bit`.
3. Crie um WAV de referência e aponte `tts.mlx.refAudio` para ele.

## Botão e ajustes

O botão de modo mostra «Auto» ou «Manual»:

- **Auto** — cada resposta concluída é lida em voz alta (sujeita a
  `autoReply.enabled`, aos motivos de fim de turno e a `announce.enabled`).
- **Manual** — o host não fala após um turno; só o botão ▶ lê. Um clique troca de
  modo na hora via `talk/applyMode`.

O botão ▶ / ⏹ mostra ▶ em repouso e ⏹ enquanto fala. O modo é estado de execução:
ao reiniciar volta ao valor configurado de `autoReply.enabled`, e o interruptor
da aba de ajustes mostra o modo atual e o grava ao salvar. Salvar acrescenta uma
operação ao patch do perfil (recarregue para aplicar).

## Solução de problemas

- Sem som: falta `ffplay` ( `brew install ffmpeg` ) ou a API key; o evento
  `plugin:dsh-talk/speech` registra o `error`.
- `minimax: 1004: invalid api key`: a chave não está no ambiente nem no
  armazenamento.
- MLX lento na primeira vez: carrega o modelo; depois reutiliza o worker.
- Um botão do compositor não faz nada: veja o log limitado
  `~/.dsh-talk/logs/diagnostics.log` (credenciais ocultas).

## Segurança e desenvolvimento

- A API key é resolvida por locução e nunca é registrada.
- Cada locução é anotada como evento `plugin:dsh-talk/speech`, sem bytes de áudio.
- Verificações: `pnpm test`, `pnpm run build`, `pnpm run check:readmes`.

## Licença

Apache-2.0.
