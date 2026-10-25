<div align="center">

# 🎙️ dsh-talk (android)

**Texto em voz na nuvem da MiniMax para a versão Android do DeepSeek Harness: as
respostas do agente são lidas em voz alta, a interface web reproduz o áudio e dois
botões ao lado do compositor alternam o modo automático/manual e leem — ou
param — a última resposta.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```

</div>

## Instalação

```sh
# canal git, branch android (o desta documentação)
dsh plugin --profile web add github:jamesylj/dsh-talk#android

# canal npm (versões publicadas)
dsh plugin --profile web add dsh-talk

# canal tarball (compile este branch primeiro)
pnpm pack && dsh plugin --profile web add ./dsh-talk-<version>.tgz
```

Remover: `dsh plugin --profile web remove dsh-talk`.

## O que faz

- **Ferramenta `speak`**: o agente fala com MiniMax `speech-2.8-turbo`.
- **Leitura automática**: ao fim de um turno a última resposta do assistente é
  lida (sem blocos de código, limitada por `autoReply.maxChars`).
- **Botão de reprodução**: um clique lê a última resposta da sessão atual; outro
  clique enquanto toca interrompe.
- **Botão de modo**: alterna **auto** (leitura automática) e **manual** (o plugin
  fica em silêncio até você clicar em ▶). É estado de execução: não grava
  configuração nem exige recarregar.
- **Anúncio de fim de turno**: uma linha curta "Turn complete." quando o turno
  não foi lido e nada está tocando.

Este branch é só para Android: o motor local MLX Qwen3-TTS e o player `ffplay` do
host, da linha `main`, foram removidos. O Android não tem MLX da Apple nem player
local, então o host sintetiza o MP3 e a interface web do DeepSeek Harness o
reproduz no WebView.

## Início rápido

1. Instale o plugin no app Android do DeepSeek Harness (veja configuração do Android).
2. Configure a API key da MiniMax (`MINIMAX_CN_API_KEY` ou o armazenamento de
   credenciais do harness).
3. Peça ao agente para usar `speak` ou envie uma mensagem normal: a resposta é
   lida ao terminar o turno e a interface reproduz.
4. Use o botão de modo para alternar auto/manual e ▶ / ⏹ para repetir ou parar.

## Configuração

Todas as chaves ficam no `config` da linha `talk` na camada de patch do perfil. O
`cordis.patch.yml` do repositório documenta cada chave.

| Chave | Padrão | Significado |
|---|---|---|
| `tts.minimax.apiKeyEnv` / `tts.minimax.credentialsFile` | `MINIMAX_CN_API_KEY` / `~/.dsh/.credentials.yaml` | Origem da API key: ambiente e depois o armazenamento de credenciais do harness (`refs:`); nunca é registrada |
| `tts.minimax.baseUrl` / `tts.minimax.model` / `tts.minimax.voiceId` | `https://api.minimax.cn/v1/t2a_v2` / `speech-2.8-turbo` / `Chinese (Mandarin)_Warm_Girl` | Endpoint, modelo e voz do sistema |
| `tts.minimax.chunkChars` / `tts.minimax.requestTimeoutMs` | `2000` / `120000` | Caracteres por requisição (texto longo é cortado por frases e concatenado) e timeout de inatividade em ms |
| `announce.enabled` | `true` | Anúncio de fim de turno quando não houve leitura automática |
| `autoReply.enabled` / `autoReply.maxChars` | `true` / `600` | Leitura automática e seu limite de caracteres |
| `maxSpeakChars` | `20000` | Limite de uma chamada `speak` |

## Como o áudio é reproduzido

Não há player no host neste branch:

1. O host chama o T2A síncrono da MiniMax com `stream: true`, decodifica os
   fragmentos MP3 hexadecimais do SSE, concatena os lotes de uma locução e
   enfileira o MP3 (limite: 6 locuções / 24 MiB).
2. A interface consulta `talk/pending` com um cursor, converte cada MP3 base64 em
   Blob e reproduz num único elemento `<audio>` compartilhado, uma locução por
   vez. A leitura automática também chega ao WebView.
3. ▶ chama `talk/playLatest` com a sessão atual; ⏹ para o elemento local e chama
   `talk/stop`, que aborta a síntese e limpa a fila. Uma locução nova só
   interrompe a **mesma sessão**; leitura automática e anúncios usam
   `interrupt: false`.

O WebView do Android pode exigir um gesto do usuário antes de reproduzir: o
primeiro toque na página desbloqueia o player; se ainda for recusado, o tooltip do
botão avisa e o próximo gesto tenta de novo.

## Configuração do MiniMax

```sh
export MINIMAX_CN_API_KEY=...
```

Vozes: `Chinese (Mandarin)_Warm_Girl`, `female-yujie`,
`Chinese (Mandarin)_Gentleman`, `Chinese (Mandarin)_News_Anchor`. Preço
aproximado ¥2 por 10 000 caracteres (um caractere chinês conta como dois); o texto
sai do dispositivo e é cobrado por caractere.

## Configuração do Android

1. Instale o [DeepSeek Harness para Android](https://github.com/woaiys3/deepseek-harness-android-app)
   (kernel `0.2.1-rc.2`, a mesma linha peer deste branch).
2. No app: console →「Plugins」, instale pelo endereço GitHub
   `github:jamesylj/dsh-talk#android` (o app inclui pnpm e git), ou copie um
   tarball compilado e instale de um diretório local.
3. Se o bundle não inserir a linha `talk`, adicione-a à camada de patch do perfil,
   inicie o motor e preencha a API key.
4. Abra uma conversa: os dois botões aparecem à esquerda do compositor.

O plugin precisa apenas de rede de saída; não inicia nenhum processo local.

## Botão de reprodução, botão de modo e ajustes

O botão de modo mostra «Auto» ou «Manual»:

- **Auto** — cada resposta concluída é lida (sujeita a `autoReply.enabled`, aos
  motivos de fim de turno e a `announce.enabled`).
- **Manual** — o host não fala após um turno; só o botão ▶ lê. Um clique troca de
  modo na hora via `talk/applyMode`.

O botão ▶ / ⏹ mostra ▶ em repouso e ⏹ enquanto toca ou sintetiza. O modo é estado
de execução: ao reiniciar volta ao valor configurado de `autoReply.enabled`, e o
interruptor da aba de ajustes reflete o modo atual e o grava ao salvar. A aba
também expõe a voz da MiniMax; salvar acrescenta uma operação ao patch do perfil
(recarregue para aplicar).

## Solução de problemas

- **Sem som**: falta a API key (`minimax: no API key`), sem rede, ou o WebView
  espera um gesto — toque uma vez na página e pressione ▶.
- **Erros de autenticação**: `minimax: 1004: invalid api key` significa que a
  chave não está no ambiente nem no armazenamento.
- **Um botão não faz nada**: veja o log limitado
  `~/.dsh-talk/logs/diagnostics.log` (credenciais ocultas).
- **Leitura longa cortada**: procure `interrupted` no log da sessão; a fila guarda
  no máximo 6 locuções / 24 MiB e um MP3 acima de 16 MiB falha com erro claro.

## Segurança e desenvolvimento

- A API key é resolvida por locução e nunca é registrada; erros são sanitizados
  antes de chegar ao log da sessão ou ao resultado da ferramenta.
- Cada locução é anotada como evento `plugin:dsh-talk/speech` (texto, motor,
  motivo, bytes, erro), sem bytes de áudio.
- O áudio sintetizado só cruza o canal Remote local, nunca é gravado em disco e é
  descartado da fila ao terminar ou ao pressionar ⏹.
- Falhas interativas acrescentam uma linha limitada e redigida em
  `~/.dsh-talk/logs/diagnostics.log`.
- Verificações: `pnpm run typecheck`, `pnpm run typecheck:ci`, `pnpm test`,
  `pnpm run build`, `pnpm run verify:self-contained`,
  `pnpm run verify:artifacts`, `pnpm run check:readmes`,
  `pnpm run check:lockfile`.

## Licença

Apache-2.0.
