<div align="center">

# 🎙️ dsh-talk

**DeepSeek Harness के लिए होस्ट पर टेक्स्ट-टू-स्पीच: एजेंट के उत्तर बोलकर सुनाए
जाते हैं, और कंपोज़र के पास के दो बटन ऑटो/मैनुअल मोड बदलते हैं तथा नवीनतम उत्तर
पढ़ते या रोकते हैं।**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-talk)](https://www.npmjs.com/package/dsh-talk)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```

</div>

## इंस्टॉल

```sh
dsh plugin --profile web add github:jamesylj/dsh-talk
dsh plugin --profile web add dsh-talk
pnpm pack && dsh plugin --profile web add ./dsh-talk-<version>.tgz
```

हटाने के लिए: `dsh plugin --profile web remove dsh-talk`.

**GitHub पथ, npm की ज़रूरत नहीं:** सीधे इस रिपॉज़िटरी से इंस्टॉल करें — DSH Desktop →
**Plugins → Add plugin**, या `dsh plugin add github:jamesylj/dsh-talk#v0.5.3`।
डेस्कटॉप लाइन `#v0.5.3` है; Android लाइन
`github:jamesylj/dsh-talk#v0.6.0-android.1` (या `#android`)। Git चाहिए और पैकेज का
build स्क्रिप्ट एक बार मंज़ूर करना होगा। पूरे चरण:
[docs/install-github.md](docs/install-github.md)।

## यह क्या करता है

- **`speak` टूल**: एजेंट होस्ट मशीन पर बोलता है।
- **ऑटो-रीड**: टर्न खत्म होने पर सहायक का अंतिम उत्तर बोलकर सुनाया जाता है
  (कोड ब्लॉक हटाकर, `autoReply.maxChars` तक सीमित)।
- **प्ले बटन**: क्लिक पर वर्तमान सत्र का नवीनतम उत्तर पढ़ा जाता है; बोलते समय
  दोबारा क्लिक करने पर रुक जाता है।
- **मोड बटन**: **auto** (हर उत्तर अपने-आप पढ़ा जाए) और **manual** (जब तक ▶ न
  दबाएँ, होस्ट चुप रहे) के बीच बदलता है। यह रनटाइम स्थिति है: कोई कॉन्फ़िग
  नहीं लिखा जाता और रीलोड की ज़रूरत नहीं।
- **टर्न-एंड घोषणा**: जब उत्तर नहीं पढ़ा गया और कोई ऑडियो नहीं चल रहा हो।
- **वैकल्पिक ऑडियो एक्सपोर्ट** (डिफ़ॉल्ट रूप से बंद)।

0.5 में वॉइस इनपुट, ब्राउज़र `<audio>` प्लेबैक, edge-tts, piper, macOS `say`
और सेटिंग्स राइट-बैक हटा दिए गए हैं।

## त्वरित शुरुआत

1. बंडल इंस्टॉल करें और प्रोफ़ाइल रीस्टार्ट करें।
2. इंजन कॉन्फ़िगर करें: डिफ़ॉल्ट MiniMax (API key चाहिए), MLX स्थानीय
   फ़ॉलबैक।
3. एजेंट से `speak` कहलवाएँ या सामान्य संदेश भेजें — टर्न खत्म होने पर उत्तर
   पढ़ा जाएगा।
4. मोड बदलने के लिए मोड बटन और अंतिम उत्तर दोबारा सुनने/रोकने के लिए ▶ / ⏹
   बटन।

MiniMax के लिए होस्ट पर `ffplay` (Homebrew `ffmpeg`) ज़रूरी है:
`brew install ffmpeg`.

## कॉन्फ़िगरेशन

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `tts.engine` / `tts.fallback` | `minimax` / `true` | इंजन (`minimax` या `mlx`); MiniMax विफल होने पर संदर्भ WAV हो तो MLX |
| `tts.minimax.apiKeyEnv` / `tts.minimax.credentialsFile` | `MINIMAX_CN_API_KEY` / `~/.dsh/.credentials.yaml` | API key का स्रोत: पहले environment, फिर harness credential store (`refs:`); key कभी लॉग नहीं होती |
| `tts.minimax.baseUrl` / `tts.minimax.model` / `tts.minimax.voiceId` | `https://api.minimax.cn/v1/t2a_v2` / `speech-2.8-turbo` / `Chinese (Mandarin)_Warm_Girl` | endpoint, मॉडल और सिस्टम वॉइस |
| `tts.minimax.player` / `tts.minimax.chunkChars` / `tts.minimax.requestTimeoutMs` | `ffplay` / `2000` / `120000` | प्लेयर, प्रति अनुरोध वर्ण और idle timeout (ms) |
| `tts.mlx.command` / `tts.mlx.script` / `tts.mlx.model` / `tts.mlx.refAudio` | venv python / bundled worker / Base 4-bit मॉडल / *(कोई नहीं)* | स्थानीय Qwen3-TTS Base x-vector क्लोन इंजन |
| `tts.export.enabled` / `tts.export.dir` | `false` / `<home>/.dsh-talk/audio` | ऑडियो फ़ाइल में लिखकर `audioPath` लौटाता है |
| `announce.enabled` | `true` | ऑटो-रीड न होने पर टर्न-एंड घोषणा |
| `autoReply.enabled` / `autoReply.maxChars` | `true` / `600` | ऑटो-रीड और उसकी वर्ण सीमा |
| `maxSpeakChars` | `20000` | एक `speak` कॉल की सीमा |

## होस्ट प्लेबैक इंजन

- **MiniMax**: सिंक्रोनस T2A को `stream: true` से कॉल करता है; SSE के MP3
  खंड सीधे एक `ffplay` के stdin में जाते हैं।
- **MLX**: resident worker क्वांटाइज़्ड Qwen3-TTS **Base** मॉडल गर्म रखता है
  और `tts.mlx.refAudio` को केवल x-vector से क्लोन करता है (preset voice या ICL
  नहीं)। खंड एक ही `sounddevice` स्ट्रीम में जाते हैं।
- नई आवाज़ केवल **उसी सत्र** की चल रही आवाज़ रोकती है; auto-read और घोषणाएँ
  `interrupt: false` भेजती हैं।
- ▶ बटन `talk/playLatest` और `talk/stop` उपयोग करता है; मोड बटन केवल मोड बदलता
  है, इसलिए manual मोड में भी ▶ काम करता है।

## MiniMax सेटअप

```sh
export MINIMAX_CN_API_KEY=...
```

सामान्य वॉइस: `Chinese (Mandarin)_Warm_Girl`, `female-yujie`,
`Chinese (Mandarin)_Gentleman`. कीमत लगभग ¥2 प्रति 10,000 अक्षर (एक चीनी अक्षर
दो गिना जाता है); पढ़ा जाने वाला टेक्स्ट मशीन से बाहर जाता है।

## MLX सेटअप

1. `~/.dsh-talk/mlx-tts-venv` में `mlx-audio` वाला venv बनाएँ।
2. Qwen3-TTS **Base** 4-bit चेकपॉइंट
   `~/.dsh-talk/models/qwen3-tts-0.6b-base-4bit` में डाउनलोड करें।
3. एक संदर्भ WAV बनाएँ और `tts.mlx.refAudio` उस पर सेट करें।

## बटन और सेटिंग्स

मोड बटन «Auto» या «Manual» दिखाता है:

- **Auto** — हर पूरा हुआ उत्तर बोलकर सुनाया जाता है (`autoReply.enabled`,
  टर्न-एंड कारण और `announce.enabled` के अधीन)।
- **Manual** — टर्न के बाद होस्ट बिलकुल चुप रहता है; केवल ▶ बटन पढ़ता है। एक
  क्लिक `talk/applyMode` से तुरंत मोड बदल देता है।

▶ / ⏹ बटन खाली होने पर ▶ और बोलते समय ⏹ दिखाता है। मोड रनटाइम स्थिति है:
रीस्टार्ट पर कॉन्फ़िगर किया गया `autoReply.enabled` डिफ़ॉल्ट लौट आता है, और
सेटिंग्स टैब का auto-reply स्विच वर्तमान मोड दिखाकर सेव करता है। सेव करने पर
प्रोफ़ाइल patch में एक ऑपरेशन जुड़ता है (लागू करने के लिए रीलोड करें)।

## समस्या निवारण

- आवाज़ नहीं: `ffplay` नहीं है ( `brew install ffmpeg` ) या API key नहीं; 
  `plugin:dsh-talk/speech` इवेंट में `error` दर्ज होता है।
- `minimax: 1004: invalid api key`: key environment या credential store में नहीं
  मिली।
- MLX पहली बार धीमा: मॉडल लोड होता है; बाद में worker दोबारा उपयोग होता है।
- कंपोज़र बटन कुछ न करे: सीमित डायग्नोस्टिक्स लॉग
  `~/.dsh-talk/logs/diagnostics.log` देखें (क्रेडेंशियल छिपे रहते हैं)।

## सुरक्षा और विकास

- API key हर utterance पर हल होती है और कभी लॉग नहीं होती।
- हर utterance `plugin:dsh-talk/speech` इवेंट के रूप में दर्ज होता है, ऑडियो
  बाइट्स नहीं।
- जाँच: `pnpm test`, `pnpm run build`, `pnpm run check:readmes`.

## लाइसेंस

Apache-2.0.
