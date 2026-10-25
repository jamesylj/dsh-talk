<div align="center">

# 🎙️ dsh-talk (android)

**DeepSeek Harness के Android संस्करण के लिए MiniMax क्लाउड टेक्स्ट-टू-स्पीच:
एजेंट के उत्तर बोलकर सुनाए जाते हैं, Web UI ऑडियो चलाता है, और कंपोज़र के पास
के दो बटन ऑटो/मैनुअल मोड बदलते हैं तथा नवीनतम उत्तर पढ़ते या रोकते हैं।**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-talk
```

</div>

## इंस्टॉल

```sh
# git चैनल, android ब्रांच (यह README इसी की है)
dsh plugin --profile web add github:jamesylj/dsh-talk#android

# npm चैनल (प्रकाशित संस्करण)
dsh plugin --profile web add dsh-talk

# tarball चैनल (पहले इस ब्रांच को बिल्ड करें)
pnpm pack && dsh plugin --profile web add ./dsh-talk-<version>.tgz
```

हटाने के लिए: `dsh plugin --profile web remove dsh-talk`.

**GitHub पथ, npm की ज़रूरत नहीं:** DSH Desktop का plugins पेज, `dsh plugin` CLI और
Android ऐप तीनों `github:jamesylj/dsh-talk#v0.6.0-android.1` (नवीनतम commit के लिए
`#android`) स्वीकार करते हैं। Git चाहिए और पैकेज का build स्क्रिप्ट एक बार मंज़ूर
करना होगा। डेस्कटॉप लाइन `github:jamesylj/dsh-talk#v0.5.3` है। पूरे चरण:
[docs/install-github.md](docs/install-github.md)।

## यह क्या करता है

- **`speak` टूल**: एजेंट MiniMax `speech-2.8-turbo` से बोलता है।
- **ऑटो-रीड**: टर्न खत्म होने पर सहायक का अंतिम उत्तर बोलकर सुनाया जाता है
  (कोड ब्लॉक हटाकर, `autoReply.maxChars` तक सीमित)।
- **प्ले बटन**: क्लिक पर वर्तमान सत्र का नवीनतम उत्तर पढ़ा जाता है; बोलते समय
  दोबारा क्लिक करने पर रुक जाता है।
- **मोड बटन**: **auto** (हर उत्तर अपने-आप पढ़ा जाए) और **manual** (जब तक ▶ न
  दबाएँ, प्लगइन चुप रहे) के बीच बदलता है। यह रनटाइम स्थिति है: कोई कॉन्फ़िग
  नहीं लिखा जाता और रीलोड की ज़रूरत नहीं।
- **टर्न-एंड घोषणा**: जब उत्तर नहीं पढ़ा गया और कोई ऑडियो नहीं चल रहा हो, छोटी
  पंक्ति "Turn complete."।

यह ब्रांच केवल Android के लिए है: `main` लाइन का स्थानीय MLX Qwen3-TTS इंजन और
होस्ट का `ffplay` प्लेयर हटा दिए गए हैं। Android में Apple का MLX और स्थानीय
ऑडियो प्लेयर नहीं है, इसलिए होस्ट MP3 बनाता है और DeepSeek Harness का Web UI
उसे WebView में चलाता है।

## त्वरित शुरुआत

1. प्लगइन को DeepSeek Harness Android ऐप में इंस्टॉल करें (नीचे Android सेटअप)।
2. MiniMax API key सेट करें (`MINIMAX_CN_API_KEY` या harness credential store)।
3. एजेंट से `speak` कहलवाएँ या सामान्य संदेश भेजें — टर्न खत्म होने पर उत्तर
   पढ़ा जाता है और इंटरफ़ेस उसे चलाता है।
4. मोड बदलने के लिए ऑटो/मैनुअल बटन और दोबारा सुनने/रोकने के लिए ▶ / ⏹ बटन।

## कॉन्फ़िगरेशन

सभी कुंजियाँ प्रोफ़ाइल patch परत की `talk` पंक्ति के `config` में हैं। रिपॉज़िटरी
का `cordis.patch.yml` हर कुंजी की व्याख्या करता है।

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `tts.minimax.apiKeyEnv` / `tts.minimax.credentialsFile` | `MINIMAX_CN_API_KEY` / `~/.dsh/.credentials.yaml` | API key का स्रोत: पहले environment, फिर harness credential store (`refs:`); key कभी लॉग नहीं होती |
| `tts.minimax.baseUrl` / `tts.minimax.model` / `tts.minimax.voiceId` | `https://api.minimax.cn/v1/t2a_v2` / `speech-2.8-turbo` / `Chinese (Mandarin)_Warm_Girl` | endpoint, मॉडल और सिस्टम वॉइस |
| `tts.minimax.chunkChars` / `tts.minimax.requestTimeoutMs` | `2000` / `120000` | प्रति अनुरोध वर्ण (लंबा टेक्स्ट वाक्यों पर काटकर जोड़ा जाता है) और idle timeout (ms) |
| `announce.enabled` | `true` | ऑटो-रीड न होने पर टर्न-एंड घोषणा |
| `autoReply.enabled` / `autoReply.maxChars` | `true` / `600` | ऑटो-रीड और उसकी वर्ण सीमा |
| `maxSpeakChars` | `20000` | एक `speak` कॉल की सीमा |

## ऑडियो कैसे चलता है

इस ब्रांच में होस्ट पर कोई प्लेयर नहीं है:

1. होस्ट MiniMax के सिंक्रोनस T2A को `stream: true` से कॉल करता है, SSE के
   हेक्स MP3 खंड डिकोड करता है, एक उच्चारण के बैच जोड़ता है और MP3 को कतार में
   रखता है (सीमा: 6 उच्चारण / 24 MiB)।
2. इंटरफ़ेस कर्सर के साथ `talk/pending` पूछता है, हर base64 MP3 को Blob बनाकर
   एक साझा `<audio>` एलिमेंट से एक-एक करके चलाता है। ऑटो-रीड का ऑडियो भी इसी
   तरह WebView में पहुँचता है।
3. ▶ वर्तमान सत्र के साथ `talk/playLatest` कहता है; ⏹ स्थानीय एलिमेंट रोककर
   `talk/stop` कहता है, जो सिंथेसिस रोकता है और कतार खाली करता है। नया उच्चारण
   केवल **उसी सत्र** को रोकता है; ऑटो-रीड और घोषणाएँ `interrupt: false` भेजती हैं।

Android WebView प्लेबैक से पहले उपयोगकर्ता के जेस्चर की मांग कर सकता है: पेज पर
पहला टैप प्लेयर अनलॉक करता है; फिर भी रुके तो बटन का tooltip बताता है और अगला
जेस्चर दोबारा कोशिश करता है।

## MiniMax सेटअप

```sh
export MINIMAX_CN_API_KEY=...
```

वॉइस: `Chinese (Mandarin)_Warm_Girl`, `female-yujie`,
`Chinese (Mandarin)_Gentleman`, `Chinese (Mandarin)_News_Anchor`. कीमत लगभग ¥2
प्रति 10,000 अक्षर (एक चीनी अक्षर दो गिना जाता है); पढ़ा जाने वाला टेक्स्ट डिवाइस
से बाहर जाता है।

## Android सेटअप

1. [DeepSeek Harness for Android](https://github.com/woaiys3/deepseek-harness-android-app)
   इंस्टॉल करें (kernel `0.2.1-rc.2`, इस ब्रांच की peer लाइन)।
2. ऐप में: कंसोल →「Plugins」, GitHub पते `github:jamesylj/dsh-talk#android` से
   इंस्टॉल करें (ऐप में pnpm और git हैं), या बिल्ड किया tarball डिवाइस पर कॉपी
   करके स्थानीय डायरेक्टरी से इंस्टॉल करें।
3. अगर bundle `talk` पंक्ति न जोड़े, तो प्रोफ़ाइल patch परत में जोड़ें, इंजन
   शुरू करें और API key भरें।
4. बातचीत खोलें: कंपोज़र के बाईं ओर दो बटन दिखेंगे।

प्लगइन को केवल outbound नेटवर्क चाहिए; कोई स्थानीय प्रोसेस नहीं चलाता।

## बटन, मोड और सेटिंग्स

मोड बटन «Auto» या «Manual» दिखाता है:

- **Auto** — हर पूरा उत्तर पढ़ा जाता है (`autoReply.enabled`, टर्न-एंड कारण और
  `announce.enabled` के अधीन)।
- **Manual** — टर्न के बाद होस्ट चुप रहता है; केवल ▶ पढ़ता है। एक क्लिक
  `talk/applyMode` से तुरंत मोड बदल देता है।

▶ / ⏹ बटन खाली होने पर ▶ और चलते/बनते समय ⏹ दिखाता है। मोड रनटाइम स्थिति है:
रीस्टार्ट पर कॉन्फ़िगर किया गया `autoReply.enabled` डिफ़ॉल्ट लौट आता है, और
सेटिंग्स टैब का auto-reply स्विच वर्तमान मोड दिखाकर सेव करता है। टैब MiniMax
वॉइस भी दिखाता है; सेव करने पर प्रोफ़ाइल patch में एक ऑपरेशन जुड़ता है (लागू
करने के लिए रीलोड)।

## समस्या निवारण

- **आवाज़ नहीं**: MiniMax API key नहीं (`minimax: no API key`), नेटवर्क नहीं, या
  WebView जेस्चर का इंतज़ार कर रहा है — पेज पर एक बार टैप करें, फिर ▶ दबाएँ।
- **प्रमाणीकरण त्रुटि**: `minimax: 1004: invalid api key` का अर्थ key environment
  या store में नहीं मिली।
- **बटन कुछ न करे**: सीमित डायग्नोस्टिक्स लॉग
  `~/.dsh-talk/logs/diagnostics.log` देखें (क्रेडेंशियल छिपे रहते हैं)।
- **लंबी रीडिंग कटे**: सत्र लॉग में `interrupted` देखें; कतार में अधिकतम 6
  उच्चारण / 24 MiB रहते हैं और 16 MiB से बड़ा MP3 स्पष्ट इंजन त्रुटि देता है।

## सुरक्षा और विकास

- API key हर utterance पर हल होती है और कभी लॉग नहीं होती; त्रुटियाँ सत्र लॉग या
  टूल परिणाम तक पहुँचने से पहले sanitize होती हैं।
- हर utterance `plugin:dsh-talk/speech` इवेंट के रूप में दर्ज होता है (टेक्स्ट,
  इंजन, कारण, बाइट्स, त्रुटि), ऑडियो बाइट्स नहीं।
- सिंथेसाइज़्ड ऑडियो केवल स्थानीय Remote चैनल से जाता है, कभी डिस्क पर नहीं
  लिखा जाता, और चलने के बाद या ⏹ पर कतार से हट जाता है।
- इंटरैक्टिव विफलताएँ `~/.dsh-talk/logs/diagnostics.log` में सीमित, redacted
  पंक्ति जोड़ती हैं।
- जाँच: `pnpm run typecheck`, `pnpm run typecheck:ci`, `pnpm test`,
  `pnpm run build`, `pnpm run verify:self-contained`,
  `pnpm run verify:artifacts`, `pnpm run check:readmes`,
  `pnpm run check:lockfile`.

## लाइसेंस

Apache-2.0.
