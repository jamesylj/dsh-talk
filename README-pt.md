<div align="center">

# 🎙️ dsh-talk
- **Canal 1024 store**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-talk` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com)).

**Loop de sessão voice-first para o DeepSeek Harness: fale com ele e ouça a resposta.**

*Pressione o microfone, fale e a resposta é lida em voz alta — falar interrompe.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-talk)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![dsh-doctor](https://raw.githubusercontent.com/PerryLink/dsh-plugin-doctor/main/badges/PerryLink__dsh-talk.svg)](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)
[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-top-rated.svg)](https://dsh.market/)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-talk/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-talk/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-talk?label=version)](https://github.com/PerryLink/dsh-talk/releases)
[![npm version](https://img.shields.io/npm/v/dsh-talk)](https://www.npmjs.com/package/dsh-talk)
[![npm downloads](https://img.shields.io/npm/dm/dsh-talk)](https://www.npmjs.com/package/dsh-talk)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-talk?metric=downloads&lang=pt)](https://dshfind.com/pt/plugins/PerryLink/dsh-talk?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```


</div>

---


**📖 Base de conhecimento do ecossistema** — dados medidos, não marketing: [guia de desenvolvimento · dados de seleção · critérios de manutenção](https://perrylink.github.io/dsh-plugin-guide/).

<!-- star-cta -->
## Instalação e desinstalação

- **Canal git** (último `main`): `dsh plugin --profile web add github:PerryLink/dsh-talk` — o script `prepare` compila apenas com dependências de produção.
- **Canal npm** (versões publicadas): `dsh plugin --profile web add dsh-talk`.
- **Canal tarball**: `pnpm pack` neste repositório e então `dsh plugin --profile web add ./dsh-talk-<version>.tgz`.
- **Desinstalar**: `dsh plugin --profile web remove dsh-talk` (ou remova a linha do patch do perfil).

> Se o pnpm reportar `ERR_PNPM_IGNORED_BUILDS` para este pacote (a validação inofensiva do binário do esbuild), adicione `allowBuilds: { esbuild: true }` ao seu `pnpm-workspace.yaml` — o CLI `dsh` imprime o trecho exato.

## ⭐ 如果它帮到了你

Este plugin faz parte da [família de plugins DSH](https://github.com/PerryLink) (mais de 40, todos Apache-2.0). Se for útil, **deixe uma estrela**: não desbloqueia nada, mas ajuda a próxima pessoa a encontrá-lo.

*English:* part of a 95 plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.

## What is dsh-talk?

Loop de sessão voice-first para o DeepSeek Harness: fale com ele e ouça a resposta.

Pressione o microfone, fale e a resposta é lida em voz alta — falar interrompe.

![Diagrama de fluxo de dsh-talk: instalar → abrir painel → agir.](docs/assets/dsh-talk-flow.svg)

*Visão geral do fluxo: instalar → abrir painel → agir. Os exemplos abaixo usam a superfície real de comandos.*


*A mesma execução, animada.*

## Compatibilidade

| Superfície | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (adaptado em 2026-09-24: terceira cláusula de peers + `engines.dsh` + `manifestVersion: 1`, e o workflow Compat mensal ancorado nessa linha); cadeia completa de gates verde em 2026-09-24 (duas réguas de typecheck, 86 testes, build, self-contained, artifacts, pack). Linha npm de desenvolvimento/teste `0.1.7-rc.2`, peers `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0 || >=0.1.7-0 <0.2.0`. |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Navegador | Web Speech + MediaRecorder (melhor no Chrome/Edge); motores de transcrição/TTS do host para o resto |

## O que você ganha

O `dsh-talk` fecha o loop de voz nos dois sentidos:

- **Ferramenta `speak`** — o agente lê suas respostas em voz alta. Motores TTS: voz do navegador, `edge-tts` (vozes neurais em rede), `piper` (local) ou a voz do sistema macOS via `/usr/bin/say` (local e offline). O áudio toca no navegador; com um motor local ele também é gravado num arquivo e o resultado da ferramenta carrega o caminho absoluto (`audioPath`) para outras ferramentas consumirem; nos hosts que podem transportá-lo, o registro de sessão guarda a fala saneada (ver Limites de segurança).
- **Botão de microfone** — pressione, fale e a transcrição cai na caixa de entrada (ou envia direto). Motores STT: Web Speech do navegador (com resultados intermediários), um servidor HTTP FunASR ou `whisper.cpp` local.
- **Falar interrompe** — começar a falar para a reprodução (canal client→host sobre o namespace `talk`).
- **Interrupção limitada** — a leitura automática e os anúncios nunca interrompem uma fala em curso: uma resposta longa é lida até o fim e a fala enfileirada vem depois; apenas o microfone (ou um `speak` explícito da mesma sessão com `interrupt: true`) interrompe a leitura atual.
- **Anúncios de eventos** — fim de turno, aprovações pendentes (seguro em cascata: nunca bloqueia o portão) e erros, com interruptor de mudo e frases configuráveis.
- **Leitura automática da resposta** — por padrão, a resposta final do assistente é lida em voz alta quando o turno é concluído, pelo mesmo pipeline de fala (speak); turnos abortados, bloqueados e com erro mantêm o anúncio "Turn complete.", e `autoReply.enabled: false` o restaura em todos (ver Leitura automática da resposta).
- **Aba de configurações** — seleção de motor/idioma, interruptores de anúncios e o de leitura automática, salvos como operações append-only do patch de perfil com backups.

## Início rápido

```sh
dsh plugin --profile web add github:PerryLink/dsh-talk
```

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add github:PerryLink/dsh-talk

# ou pelo npm (versões publicadas)
dsh plugin --profile web add dsh-talk

# 2. reinicie e verifique a linha
dsh --profile web --dump-config | grep -A2 'id: talk'
```

Depois pressione o microfone ao lado do compositor e fale; ou peça ao agente para falar:

```
> Diga "olá" com a ferramenta speak.
```

## Navegadores remotos precisam de uma origem segura

O microfone do navegador (`getUserMedia` / Web Speech / MediaRecorder) só funciona em um
**contexto seguro**: `https://…` ou `http://localhost` / `http://127.0.0.1`. Uma página
`http://<IP-LAN>:3081` — inclusive Safari em outra máquina — não expõe o microfone, mesmo
com as configurações do Talk corretas.

Para um navegador remoto, use uma destas opções:

- abrir a Web UI por um proxy reverso HTTPS ou túnel;
- encaminhar a porta por SSH e abrir `http://localhost:<porta>` no cliente;
- manter a UI na mesma máquina do navegador.

`stt.engine: funasr` / `whisper` muda *onde a transcrição roda*, não a permissão de captura
do navegador; gravar ainda exige o contexto seguro.

### Exemplos

São as superfícies reais; a aba de ajustes e o botão de microfone são as entradas de UI.

#### Exemplo detalhado

**Comando**

~~~sh
speak
~~~

**Entrada**

~~~json
{"text":"hello","engine":"browser"}
~~~

**Saída**

~~~text
Spoke hello aloud with the browser engine. No audio file: the browser engine synthesizes in the browser.
~~~

*Observado em `plugins/dsh-talk/tests/lifecycle.spec.ts:124-137; renderer at src/tool.ts:47-64`*

#### Ramo de falha

**Entrada**

~~~text
{"text":"   "}
~~~

**Saída**

~~~text
Error: dsh-talk: speak text must not be empty
~~~

*Observado em `plugins/dsh-talk/src/tool.ts:124; plugins/dsh-talk/tests/tool.spec.ts:41-44`*

#### Exemplos breves

- `talk:status`
- `talk:transcribe`

## Configuração

Todos os ajustes são campos `Config` do Schemastery (alteráveis pelo cordis.yml). O `cordis.patch.yml` documenta cada chave.

| Chave | Padrão | Significado |
|---|---|---|
| `record.enabled` | `true` | Mostrar o botão de microfone do compositor |
| `record.hotkey` | *(nenhuma)* | Atalho opcional, ex. `"alt+r"` |
| `record.maxSeconds` | `60` | Limite de gravação em segundos (1..600) |
| `record.autoSubmit` | `false` | Enviar a transcrição como mensagem do usuário (false = preencher o rascunho) |
| `record.vad.enabled` / `silenceMs` / `energyThreshold` | `true` / `1500` / `0.01` | Detecção de atividade de voz: o silêncio encerra a gravação automaticamente (degrada para parada manual sem `AudioContext`) |
| `stt.engine` | `auto` | `auto` / `web` / `funasr` / `whisper`; auto prefere um motor local configurado, depois Web Speech |
| `stt.language` | `auto` | Idioma BCP-47 ou `auto` |
| `stt.interim` | `true` | Mostrar transcrições intermediárias (Web Speech) |
| `stt.silenceFinaliseMs` | `4000` | Parar o Web Speech contínuo após estes milissegundos sem fala (500..15000) |
| `stt.funasr.url` | *(nenhuma)* | Endpoint de inferência FunASR; obrigatório com o motor `funasr`; um valor vazio conta como não configurado |
| `stt.whisper.modelPath` | *(nenhuma)* | Modelo whisper.cpp; obrigatório com o motor `whisper`; um valor vazio conta como não configurado |
| `tts.engine` | `auto` | `auto` / `browser` / `edge-tts` / `macos` / `mlx` / `piper`; auto prefere piper, depois edge-tts, depois a voz do navegador; `macos` usa a voz do sistema (somente macOS); `mlx` roda localmente um Qwen3-TTS quantizado em Apple Silicon |
| `tts.mlx.command` | `~/.dsh-talk/mlx-tts-venv/bin/python` | Interpretador Python do venv MLX (inferência local em Apple Silicon) |
| `tts.mlx.script` | *(incluído)* | Script worker; vazio = o `worker/mlx_tts.py` incluído |
| `tts.mlx.model` | `~/.dsh-talk/models/qwen3-tts-0.6b-4bit` | Diretório do modelo Qwen3-TTS quantizado ou repo id do HF |
| `tts.mlx.voice` | `Vivian` | Voz CustomVoice do Qwen3-TTS |
| `tts.mlx.language` | `Chinese` | Idioma passado ao modelo |
| `tts.mlx.chunkChars` | `100` | Tamanho do trecho (20..500); menor = primeiro áudio mais rápido |
| `tts.mlx.player` | `/usr/bin/afplay` | Player do sistema que toca cada trecho enquanto o próximo é sintetizado |
| `tts.mlx.temperature` | `0.6` | Temperatura de amostragem (0..1.5); menor = mais estável, menos deriva de dialeto/idioma |
| `tts.mlx.topP` | `0.9` | Amostragem nucleus top-p (0.05..1) |
| `tts.mlx.topK` | `30` | Amostragem top-k (0..200) |
| `tts.mlx.mode` | `custom` | `custom` = voz predefinida CustomVoice; `clone` = clona a voz de `tts.mlx.refAudio` (somente modelo Base) |
| `tts.mlx.refAudio` | *(nenhum)* | WAV de referência para clone; obrigatório com `mode: clone` |
| `tts.mlx.refText` | *(nenhum)* | Transcrição exata de `tts.mlx.refAudio`; só para `cloneMode: icl` |
| `tts.mlx.cloneMode` | `xvector` | `xvector` (só embedding do falante, mais rápido) ou `icl` (áudio + texto) |
| `tts.rate` | `0` | Deslocamento de velocidade em porcentagem (-50..50) para edge-tts/piper; também escala a velocidade do `say` no macOS |
| `tts.macos.command` | `/usr/bin/say` | Executável `say` do macOS (local e offline; o motor `macos` só existe no macOS) |
| `tts.macos.voice` | `Eddy (中文（中国大陆）)` | Nome da voz instalada exatamente como `say -v '?'` lista; um nome desconhecido é rejeitado em vez de usar a voz padrão silenciosamente |
| `tts.macos.rate` | `175` | Velocidade base em palavras por minuto para `say`; `tts.rate` a escala em porcentagem (60..400) |
| `tts.fallbackToBrowser` | `true` | Cair para a voz do navegador quando um motor local falha |
| `tts.browser.voiceName` | *(nenhuma)* | Nome preferido da voz do navegador; se não existir, usa o padrão da plataforma |
| `tts.browser.rate` | `1` | Velocidade do SpeechSynthesis do navegador (0.1..10) |
| `tts.browser.pitch` | `1` | Tom do SpeechSynthesis do navegador (0..2) |
| `tts.piper.modelPath` | *(nenhuma)* | Modelo de voz piper; obrigatório com o motor `piper`; um valor vazio conta como não configurado |
| `tts.export.enabled` | `true` | Gravar o áudio sintetizado localmente num arquivo e devolver seu caminho como `audioPath` |
| `tts.export.dir` | `<home>/.dsh-talk/audio` | Diretório de exportação; `~` = home, um caminho relativo resolve sob o home (nunca o workspace) |
| `tts.export.maxFiles` | `20` | Arquivos mantidos no diretório, contando o recém-gravado (1..1000) |
| `tts.export.maxAgeMinutes` | `1440` | Arquivos exportados mais antigos que estes minutos são removidos na próxima gravação (1..10080) |
| `announce.enabled` | `true` | Interruptor mestre de anúncios |
| `announce.onTurnEnd` / `onApproval` / `onError` | `true` | Quais eventos são falados |
| `announce.messages.*` | *"Turn complete." etc.* | Frases faladas |
| `autoReply.enabled` | `true` | Ler em voz alta a resposta final do assistente ao concluir o turno (pipeline speak; ver Leitura automática da resposta) |
| `autoReply.maxChars` | `600` | Limite de caracteres da resposta lida; respostas mais longas são truncadas num espaço (1..100000) |
| `autoReply.skipIfToolSpoke` | `true` | Não ler automaticamente um turno que já falou pela ferramenta `speak` |
| `autoReply.skipSubagents` | `true` | Nunca ler automaticamente sessões de subagente/agente de equipa |
| `autoReply.reasons` | `completed`, `max-tokens` | Razões de `turn/end` que são lidas (`completed` / `max-tokens`); as demais não são lidas e caem no anúncio |
| `interrupt` | `true` | Falar para a reprodução atual |
| `maxSpeakChars` | `20000` | Limite do texto da ferramenta speak (1..100000) |
| `maxAudioCacheBytes` | `8388608` | Limite da cache de áudio em memória (1 MiB..64 MiB) |

`stt.silenceFinaliseMs` e `record.vad.silenceMs` são mecanismos distintos: o primeiro finaliza a transcrição do Web Speech quando o reconhecimento contínuo deixa de ouvir fala; o segundo é o detetor por energia do MediaRecorder que encerra a gravação (e a envia quando `record.autoSubmit` está ativo). Correm em pipelines diferentes e não partilham estado.

### Leitura automática da resposta

Por padrão (`autoReply.enabled: true`), a resposta final do assistente de um turno concluído é lida em voz alta pelo mesmo pipeline de fala da ferramenta `speak`: mesmo motor, voz, cache de áudio e regras de exportação. `autoReply.enabled: false` desativa-a e deixa o caminho dos anúncios exatamente como antes.

- **Que turnos**: apenas as razões de `turn/end` listadas em `autoReply.reasons` — `completed` e `max-tokens` por padrão. Turnos abortados, bloqueados e com erro não são lidos e mantêm o antigo anúncio "Turn complete.". Usa-se apenas o último `assistant/message` confirmado desse turno, pelo que um turno com chamadas de ferramentas lê o seu texto final e não um passo intermédio.
- **O que é lido**: os blocos de texto da resposta unidos por quebras de linha, sem blocos de código cercados nem crases em linha — o código nunca é lido como prosa — e depois truncados num limite de espaço para `autoReply.maxChars` caracteres (padrão 600, 1..100000). Uma resposta que fica vazia depois de remover o código não é lida.
- **Supressão do anúncio**: num turno cuja resposta é lida, a frase genérica "Turn complete." não é pronunciada, para que nunca falem ao mesmo tempo. Um turno não tratado (uma razão de fim não permitida, uma sessão de subagente) mantém o anúncio quando `announce.onTurnEnd` está ativo.
- **Sem leitura dupla**: `autoReply.skipIfToolSpoke: true` salta um turno que já chamou a ferramenta `speak`, e uma resposta é deduplicada pelo id da mensagem do assistente, pelo que um disparo repetido nunca a lê duas vezes.
- **Subagentes**: `autoReply.skipSubagents: true` nunca lê sessões criadas por um subagente ou agente de equipa (`origin: subagent` ou profundidade de delegação diferente de zero).
- **Reprodução serializada**: uma fala nova para e liberta o leitor de áudio anterior e cancela qualquer `SpeechSynthesis` do navegador em curso, pelo que turnos consecutivos lidos automaticamente nunca se sobrepõem.
- **Wire**: a fala é registada com a razão `auto-reply`, que a projeção `talk:speech` e `talk/latest` carregam, e é exportada como qualquer outra fala quando um motor local a sintetiza.
- **Interruptor nas configurações**: o painel Configurações → Plugins → Talk expõe o mesmo interruptor que `autoReply.enabled`; salvar acrescenta-o ao patch de perfil, então recarregue o perfil para aplicar (o limite de caracteres e os dois guards continuam apenas na configuração).

### Exportação para arquivo de áudio

Cada fala sintetizada por um motor local (`edge-tts`, `piper`, `macos`) é gravada num arquivo **além de** entrar na cache em memória de onde o navegador reproduz. O motor do navegador sintetiza no cliente e por isso não exporta nada — esse estado é **relatado explicitamente**, nunca em silêncio.

- **Onde**: `tts.export.dir`, por padrão `<home>/.dsh-talk/audio` — o diretório do próprio plugin. Deliberadamente nunca é o diretório de trabalho do host, então jamais polui um repositório; um `tts.export.dir` relativo resolve sob o diretório home pelo mesmo motivo.
- **Nomes**: `speech-<YYYYMMDD>T<HHMMSS>Z-<8 hex>.mp3` (edge-tts) ou `.wav` (piper/macos). A marca é UTC, então os nomes ordenam cronologicamente, e o token vem do id da fala, de modo que um arquivo remonta à sua entrada de registo de fala (`dsh-talk/speech`, ou `plugin:dsh-talk/speech` em hosts `0.2.1+`). O texto falado nunca faz parte do nome.
- **Limpeza**: limitada a cada gravação, primeiro por idade e depois por quantidade. Arquivos mais antigos que `tts.export.maxAgeMinutes` (padrão 1440 = 24 h) são removidos, e depois os mais antigos até o diretório não passar de `tts.export.maxFiles` (padrão 20, contando o recém-gravado). A limpeza só remove nomes que casam com o padrão `speech-…` deste plugin, então nunca toca outros arquivos num diretório partilhado. Com os padrões o diretório guarda no máximo 20 arquivos (alguns MB) e nada com mais de um dia.
- **Falha**: exportar é um acréscimo à fala, nunca uma precondição. Se o diretório não puder ser criado ou gravado, a fala toca igual e o resultado relata `audioExport: "failed"` com o motivo; falhas de limpeza são ignoradas e retentadas na próxima gravação.
- **Caminho visível ao modelo**: o valor canônico da ferramenta `speak` carrega `audioPath` (mais `audioExport` e, quando não há arquivo, `exportNote`), e o mesmo caminho está no texto renderizado — assim o agente pode passá-lo direto a outra ferramenta que aceite um arquivo, por exemplo o argumento de arquivo de um plugin de mensagens. Os anúncios de eventos (fim de turno, aprovação, erro) são sintetizados pelo mesmo pipeline e exportados do mesmo modo, com os mesmos limites.
- **Entregar o arquivo a outro plugin**: um consumidor que só aceita arquivos dentro do próprio workspace — o `send_wechat` do `dsh-wechat` recusa um `file_path` fora do workspace da sessão chamadora, a menos que o ajuste `allowAnyFilePath` dele esteja ligado — vai recusar um caminho sob o seu diretório home. Para esse fluxo, aponte `tts.export.dir` para um diretório dentro desse workspace (por exemplo `<workspace>/.dsh-talk-audio`); o padrão fica fora de qualquer repositório de propósito.

## Ferramentas e superfícies

| Superfície | Tipo | Notas |
|---|---|---|
| `speak` | ferramenta | Lê texto em voz alta (browser/edge-tts/macos/piper); overrides de motor/voz por chamada; resultado JSON canônico |
| botão de microfone | slot `conversation.input.left` | Gravar → transcrever → preencher rascunho (ou enviar); falar interrompe ao pressionar |
| aba de configurações | `settings.plugins.tab` (id `talk`) | Motores/idioma/anúncios/leitura automática; salvamento append-only |
| `talk:*` | Typert Remote | `status`, `audio`, `transcribe`, `applySettings`, `interrupt` (namespace do host) |

## Permissões e dados

- **Permissões**: o plugin mantém uma cache de áudio em memória com limite de bytes para reprodução e, com motores locais, grava o áudio sintetizado no próprio diretório limitado (`tts.export.*`, padrão `<home>/.dsh-talk/audio`, no máximo 20 arquivos e 24 h por padrão); a permissão do microfone é mediada pelo navegador. A aba de configurações apenas anexa fragmentos ao patch do perfil com backup — nunca reescreve o arquivo.
- **Dados**: os bytes de áudio nunca entram no contexto do modelo nem no registro de sessão. O evento `dsh-talk/speech` carrega o id da fala, motor, razão, tamanho, texto saneado e, quando aplicável, voz, velocidade e tom do navegador; hosts cujo vocabulário de sessão conhece esse tipo de evento recebem-no diretamente, hosts `0.2.1+` recebem-no como um registo de plugin ignorável experimental (`plugin:dsh-talk/speech` — ver Compatibilidade do host) e hosts sem envelope não escrevem nada. O resultado da ferramenta `speak` carrega o caminho do arquivo exportado (um artefato persistente no diretório do próprio plugin), e tudo o mais numa superfície de exibição/registro passa pelos ajudantes de redação, então credenciais, JWT, cabeçalhos bearer e caminhos temporários ficam de fora.
- **Rede**: apenas os motores que você configurar são contatados. `edge-tts` faz síntese pela rede, o FunASR usa seu endpoint configurado e o `webkitSpeechRecognition` do Chrome envia o áudio do microfone aos servidores do Google para transcrição; a reprodução de `speechSynthesis` do navegador permanece local.

## Limites de segurança

- **Visível para o modelo ⟺ registado** — o modelo vê apenas o valor canônico e o texto renderizado da ferramenta speak. O evento `dsh-talk/speech` — um evento de sessão normal onde o vocabulário do host o conhece, um registo `plugin:dsh-talk/speech` ignorável em hosts `0.2.1+` — é anexado apenas quando o host pode transportá-lo (ver Compatibilidade do host); os eventos `tool/call` + `tool/result` continuam sendo sempre o rastro reconstruível.
- **Anúncios de aprovação nunca bloqueiam** — o listener de `approval/request` sempre chama `next()`.
- **Saída saneada** — credenciais e caminhos temporários de áudio nunca chegam a registros ou telas. A única exceção deliberada é o caminho do áudio exportado no resultado do speak: é um arquivo persistente no diretório do próprio plugin (mesmo assim passa pelo redator de segredos) e existe justamente para ser entregue a outra ferramenta.
- **Compatibilidade do host** — o evento `dsh-talk/speech` é anexado por uma comporta de três vias: hosts cujo vocabulário de tipos conhecidos cobre o evento anexam-no diretamente e a chamada relata isso; hosts que publicam a API experimental `appendPluginRecord` (`0.2.1+`) anexam um registo de plugin ignorável chamado `plugin:dsh-talk/speech` (a gramática de tipos de plugin record é `plugin:` seguido de segmentos em minúsculas separados por barras), que a projeção `talk:speech` dobra exatamente como o evento normal — é isto que restaura a reprodução ao vivo no cliente; hosts sem qualquer das duas vias — toda linha publicada até `0.1.1-rc.2`, a linha `0.1.2-alpha`, `0.1.2-rc.1` e `0.1.6-alpha.2`, cujo `Session.append` só consegue estampar o surface intent e não o envelope `ignorable` (esse campo é mantido apenas para compatibilidade de leitura) — não recebem nenhum append, então a fala nunca polui o registo de sessão ali. O salto não é mais silencioso: o host mantém contadores de anexados/omitidos por sessão e `talk/latest(sessionId)` os devolve; a lista de reprodução da sessão no cliente fica vazia e os resultados da ferramenta speak continuam sendo o rastro reconstruível. O canal de plugin records requer um host `0.2.1+`.
- **Falha ruidosa** — motores inválidos, valores fora de faixa e motores sem seu modelo/endpoint obrigatório falham ao montar.

## Limitações conhecidas

- **Suporte de navegador**: Web Speech e MediaRecorder são detectados por capacidade; sem eles o botão desativa e os motores do host (FunASR/whisper.cpp) podem transcrever quando configurados.
- **Motores locais são instalação sua**: os executáveis e modelos de `edge-tts`, `piper` e `whisper.cpp` devem ser instalados à parte; o motor `macos` só precisa do `/usr/bin/say` do sistema.
- **edge-tts falha com 403 (`WSServerHandshakeError`)** — o serviço rejeita versões antigas; atualize para edge-tts ≥ 7.3.1 (um venv dedicado serve) e aponte `tts.edgeTts.command` para o caminho absoluto.
- **Arquivos de áudio exigem um motor local**: a voz do navegador sintetiza no cliente, então ali `speak` não devolve `audioPath` (o resultado diz isso explicitamente), e um motor local que falha e cai para o navegador também não deixa arquivo. Os arquivos exportados ficam no diretório limitado do próprio plugin — ver Exportação para arquivo de áudio para local, nomes e limpeza.
- **Formato de gravação**: o navegador grava com seu codec nativo do MediaRecorder; o whisper.cpp pode exigir um gravador WAV ou conversão no servidor.
- **Configurações aplicam ao recarregar**: a aba anexa ao patch do perfil; um reload do perfil (ou reinício da web) ativa as mudanças.
- **O histórico de reprodução ao vivo só fica vazio em hosts `0.1.x` sem envelope**: em `0.1.1-rc.2`, na linha `0.1.2-alpha`, em `0.1.2-rc.1` e em `0.1.6-alpha.2` o vocabulário do host não conhece `dsh-talk/speech` e o canal de plugin records não está disponível, então a comporta não escreve nada e a lista de reprodução da sessão no cliente fica vazia; `talk/latest(sessionId)` continua respondendo com a última fala (incluindo a razão `auto-reply`) e o contador de omitidos. Em hosts `0.2.1+` o canal de plugin records restaura a reprodução ao vivo. A fala em si, o microfone, a aba de configurações e a ferramenta não são afetados.
- **Registros antigos escritos pelo dsh-talk ≤ 0.2.1 podem exigir reparo antes do carregamento a frio**: versões até `0.2.1` anexavam eventos `dsh-talk/speech` sem marca. Em hosts `0.1.0-rc.7` ou mais recentes, uma sessão cujo registro já os contém falha no próximo carregamento a frio com `SessionFormatUnsupportedError`. Reparação: pare o host, faça cópia do registo `.jsonl` da sessão, acrescente `"ignorable":true` como membro de topo em cada linha JSON cujo `"type"` seja `"dsh-talk/speech"` (por exemplo, insira `"ignorable":true,` logo a seguir à `{` inicial) e reabra a sessão. Nada mais muda e nada se perde; novos appends desta versão nunca adicionam eventos sem marca.

## Desenvolvimento

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc: src + tests contra o checkout local do harness
pnpm run typecheck:ci  # tsc contra os tipos publicados 0.1.7-alpha.2 (sem paths)
pnpm test           # vitest: 154 testes, 17 suítes
pnpm run build      # declarações tsc + bundles tsdown (lib/)
pnpm run verify:self-contained  # as specs de dependências resolvem pelo registry
pnpm run verify:artifacts       # faces ESM construídas + handshake ModuleLoader do cliente
pnpm pack           # o tarball publicado
```

## Interoperabilidade com outros plugins do DSH

Verificado contra **DSH `0.2.0-rc.2`** (o runtime para o qual este README é publicado) e o conjunto de plugins com mais estrelas pesquisado em 2026-10-05.

Este plugin **não interfere** em outros plugins, incluindo os de mais estrelas:

- **Sem colisão de nome de ferramenta.** Todas as ferramentas têm namespace; nenhuma ocupa um nome puro já pertencente a uma ferramenta embutida ou a outro plugin.
- **Sem colisão de chave de serviço.** Fornece apenas `talk`; essa chave não é uma costura embutida nem é fornecida por nenhum plugin de mais estrelas.
- **Sem colisão de slot.** Não registra nenhuma chave de slot de cliente, então não disputa um assento `shadows-shipped-ui`.
- **Sem colisão de rota HTTP.** Não registra nenhum prefixo `webServer`.
- **Sem colisão na camada de patch.** O patch do bundle apenas faz `insert` da própria linha; nunca sobrescreve o `config` de uma linha embutida.
- **Sem mutação global.** Não altera protótipos, não reescreve `process.env` nem substitui o dispatcher global de fetch.

**Listeners de eventos compartilhados não interferem por construção.** Observa os eventos sensíveis à ordem `approval/request` com `ctx.on()` — o registro de difusão do Cordis, onde cada listener executa e nenhum pode privar outro do turno. **Todos os listeners aqui delegam via `next()`**, então a cadeia nunca é curto-circuitada:

Evidência estática: `dsh-plugin-doctor` K10–K13 retornam `pass` em todas as verificações deste repositório.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `deepseek`, `cordis`, `voice`, `speech`, `tts`, `stt`, `speech-to-text`, `text-to-speech`, `microphone`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: pipeline de voz, motores de fala, gravador de microfone, anúncios de eventos, unidade de projeção e a documentação em cinco idiomas.

## PerryLink DSH Plugin Family

Este projeto faz parte da família de plugins do DeepSeek Harness da [PerryLink](https://github.com/PerryLink). O registro fica recolhido abaixo para que cada README mantenha uma primeira tela curta; expanda para ver cada linha e seu status.

<details>
<summary>Expandir todos os plugins</summary>

| Plugin | Status |
|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** |  |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** |  |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** |  |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** |  |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** |  |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** |  |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** |  |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** |  |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | 🚫 RETIRADO — ver o README do repositório |

</details>

## License

[Apache License 2.0](LICENSE) © 2026 dsh-talk contributors

### Instalar a partir do mercado do DSH Desktop

Todos os plugins PerryLink podem ser explorados no mercado integrado do DSH Desktop: **Market → Sources → add source → colar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ selecionar**. A instalação continua passando pela verificação de identidade npm do mercado e pela sua confirmação.
