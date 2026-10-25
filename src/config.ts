/**
 * Plugin configuration and its explicit resolve step. `resolveConfig` re-judges
 * every default and bound so programmatic construction that bypasses
 * Schemastery normalization still fails loud instead of running with hidden
 * defaults (the explicit-resolve contract).
 *
 * @module dsh-talk/config
 */

import z from '@deepseek-ai/schemastery'
import { resolveExportDir } from './audio-export.ts'

/** Speech-to-text engines. `auto` prefers a configured local engine, then Web Speech. */
export type SttEngine = 'auto' | 'web' | 'funasr' | 'whisper'

/** Text-to-speech engines. `auto` prefers piper, then edge-tts; `macos` is the system voice. */
export type TtsEngine = 'auto' | 'browser' | 'edge-tts' | 'macos' | 'piper'

/** Turn-end reasons that can trigger auto-read of the assistant's final reply. */
export type AutoReplyReason = 'completed' | 'max-tokens'

/** Default recording cap in seconds. */
export const DEFAULT_MAX_RECORD_SECONDS = 60

/** Ceiling for one recording: the client holds the whole clip in memory. */
export const MAX_RECORD_SECONDS = 600

/** Default speak-tool text cap in characters. */
export const DEFAULT_MAX_SPEAK_CHARS = 20_000

/** Ceiling for one speak request. */
export const MAX_SPEAK_CHARS = 100_000

/** Default Web Speech silence window before dictation auto-finalises. */
export const DEFAULT_SILENCE_FINALISE_MS = 4000

/** Default announce-master switch. */
export const DEFAULT_ANNOUNCE_ENABLED = true

/** Default cap on one auto-read utterance in characters. */
export const DEFAULT_AUTO_REPLY_MAX_CHARS = 600

/** Ceiling for one auto-read utterance (the speak tool's ceiling). */
export const MAX_AUTO_REPLY_MAX_CHARS = 100_000

/** Turn-end reasons that trigger auto-read by default (frozen: it is the resolver's fallback). */
export const DEFAULT_AUTO_REPLY_REASONS: readonly AutoReplyReason[] = Object.freeze(['completed', 'max-tokens'])

/** Default macOS `say` executable. */
export const DEFAULT_MACOS_COMMAND = '/usr/bin/say'

/** Default macOS voice: the zh_CN "Eddy" voice as `say -v '?'` names it. */
export const DEFAULT_MACOS_VOICE = 'Eddy (中文（中国大陆）)'

/** Default macOS speech-rate anchor in words per minute (`tts.rate` scales it). */
export const DEFAULT_MACOS_RATE = 175

/** Lower bound for the macOS speech-rate anchor (words per minute). */
export const MIN_MACOS_RATE = 60

/** Upper bound for the macOS speech-rate anchor (words per minute). */
export const MAX_MACOS_RATE = 400

/** Default in-memory audio cache cap in bytes (8 MiB). */
export const DEFAULT_MAX_AUDIO_CACHE_BYTES = 8 * 1024 * 1024

/** Ceiling for the audio cache. */
export const MAX_AUDIO_CACHE_BYTES = 64 * 1024 * 1024

/** Default cap on exported audio files retained in the export directory. */
export const DEFAULT_EXPORT_MAX_FILES = 20

/** Ceiling for the exported-audio file count. */
export const MAX_EXPORT_MAX_FILES = 1_000

/** Default age cap (minutes) for exported audio files (24 hours). */
export const DEFAULT_EXPORT_MAX_AGE_MINUTES = 1_440

/** Ceiling for the exported-audio age cap (7 days). */
export const MAX_EXPORT_MAX_AGE_MINUTES = 10_080

/** Default silence duration (ms) before the recorder auto-ends and submits. */
export const DEFAULT_VAD_SILENCE_MS = 1_500

/** Ceiling for one VAD silence window. */
export const MAX_VAD_SILENCE_MS = 10_000

/** Default RMS energy floor above which a frame counts as speech (0..1). */
export const DEFAULT_VAD_ENERGY_THRESHOLD = 0.01

/** Voice-activity detection for the recorder (silence auto-end). */
export interface VadConfig {
  /** Detect silence and auto-end the recording (default true; degrades when AudioContext is absent). */
  enabled?: boolean
  /** Consecutive silence in milliseconds before the recording auto-ends (default 1500). */
  silenceMs?: number
  /** RMS energy floor (0..1) above which audio counts as speech (default 0.01). */
  energyThreshold?: number
}

/** Recording behavior: the composer microphone button and its hotkey. */
export interface RecordConfig {
  /** Show the microphone button and allow recording (default true). */
  enabled?: boolean
  /** Optional toggle hotkey such as "alt+r"; unset = click only. */
  hotkey?: string | null
  /** Recording cap in seconds (default 60). */
  maxSeconds?: number
  /** Submit the transcription as the user message automatically (default false). */
  autoSubmit?: boolean
  /** Voice-activity detection (silence auto-end). */
  vad?: VadConfig
}

/** Speech-to-text configuration. */
export interface SttConfig {
  /** Engine selection: auto | web | funasr | whisper (default auto). */
  engine?: SttEngine
  /** BCP-47 language code such as "en-US", or "auto" (default auto). */
  language?: string
  /** Show interim transcriptions while speaking (Web Speech; default true). */
  interim?: boolean
  /** Silence window in ms after which continuous Web Speech dictation auto-finalises (default 4000). */
  silenceFinaliseMs?: number
  /** FunASR HTTP inference server (used when engine resolves to funasr). */
  funasr?: {
    /** Full inference endpoint URL; required for the funasr engine. */
    url?: string
    /** Model name sent to the server; unset = server default. */
    model?: string
  }
  /** whisper.cpp local engine (used when engine resolves to whisper). */
  whisper?: {
    /** whisper.cpp executable (default "whisper-cli"). */
    command?: string
    /** Model file path; required for the whisper engine. */
    modelPath?: string
    /** Language override; unset = the global stt.language or auto-detect. */
    language?: string
  }
}

/** Exported-audio lifecycle: the plugin-owned, bounded file directory. */
export interface TtsExportConfig {
  /** Write every locally synthesized utterance to a file (default true). */
  enabled?: boolean
  /** Target directory; empty = `<home>/.dsh-talk/audio`, `~` expands to home, a relative path resolves under home. */
  dir?: string
  /** Files retained in the directory, counting the one just written (default 20). */
  maxFiles?: number
  /** Files older than this many minutes are removed on the next write (default 1440). */
  maxAgeMinutes?: number
}

/** macOS system voice (`say`) engine configuration. */
export interface TtsMacosConfig {
  /** `say` executable (default "/usr/bin/say"). */
  command?: string
  /** Installed voice name exactly as `say -v '?'` lists it (default "Eddy (中文（中国大陆）)"). */
  voice?: string
  /** Baseline speech rate in words per minute; the `tts.rate` percent scales it (default 175, 60..400). */
  rate?: number
}

/** Text-to-speech configuration. */
export interface TtsConfig {
  /** Engine selection: auto | browser | edge-tts | macos | piper (default auto). */
  engine?: TtsEngine
  /** edge-tts voice override; unset = `tts.edgeTts.voice`. The macOS engine uses `tts.macos.voice`. */
  voice?: string
  /** Rate offset in percent (-50..50) for edge-tts/piper/macos (default 0). */
  rate?: number
  /** Fall back to the browser voice when a local engine fails (default true). */
  fallbackToBrowser?: boolean
  /** Browser SpeechSynthesis settings. */
  browser?: {
    /** Preferred voice name; unset = platform default. */
    voiceName?: string
    /** SpeechSynthesis rate 0.1..10 (default 1). */
    rate?: number
    /** SpeechSynthesis pitch 0..2 (default 1). */
    pitch?: number
  }
  /** edge-tts local engine. */
  edgeTts?: {
    /** edge-tts executable (default "edge-tts"). */
    command?: string
    /** Azure neural voice name (default "en-US-JennyNeural"). */
    voice?: string
  }
  /** piper local engine. */
  piper?: {
    /** piper executable (default "piper"). */
    command?: string
    /** piper voice model file; required for the piper engine. */
    modelPath?: string
  }
  /** macOS system voice (`say`, local and offline; macOS hosts only). */
  macos?: TtsMacosConfig
  /** Exported-audio files: where they go and how the directory is bounded. */
  export?: TtsExportConfig
}

/** Event announcement configuration. */
export interface AnnounceConfig {
  /** Master switch for all event announcements (default true). */
  enabled?: boolean
  /** Announce turn completion (default true). */
  onTurnEnd?: boolean
  /** Announce pending approvals (default true). */
  onApproval?: boolean
  /** Announce errors (default true). */
  onError?: boolean
  /** Spoken phrases; the English strings are the defaults. */
  messages?: {
    /** Spoken on turn completion (default "Turn complete."). */
    turnEnd?: string
    /** Spoken when an approval is requested (default "Approval required."). */
    approval?: string
    /** Spoken on error (default "Something went wrong."). */
    error?: string
  }
}

/** Default auto-read of the assistant's final reply. */
export interface AutoReplyConfig {
  /** Read the assistant's final reply aloud when a turn ends (default true). */
  enabled?: boolean
  /** Cap on the spoken reply in characters; longer replies truncate at a word boundary (default 600). */
  maxChars?: number
  /** Skip auto-read when the same turn already called the speak tool (default true). */
  skipIfToolSpoke?: boolean
  /** Never auto-read subagent/delegated sessions (default true). */
  skipSubagents?: boolean
  /** Turn-end reasons that trigger auto-read (default ["completed", "max-tokens"]). */
  reasons?: AutoReplyReason[]
}

/** Plugin configuration. */
export interface Config {
  /** Microphone recording behavior. */
  record?: RecordConfig
  /** Speech-to-text configuration. */
  stt?: SttConfig
  /** Text-to-speech configuration. */
  tts?: TtsConfig
  /** Event announcement configuration. */
  announce?: AnnounceConfig
  /** Default auto-read of the assistant's final reply. */
  autoReply?: AutoReplyConfig
  /** Whether starting to talk interrupts current playback (default true). */
  interrupt?: boolean
  /** Cap on the speak tool's text length in characters (default 20000). */
  maxSpeakChars?: number
  /** In-memory synthesized-audio cache cap in bytes (default 8388608). */
  maxAudioCacheBytes?: number
}

/** Fully resolved configuration captured at plugin load. */
export interface ResolvedConfig {
  /** Whether the composer microphone button is enabled. */
  recordEnabled: boolean
  /** Toggle hotkey, or null for click-only. */
  recordHotkey: string | null
  /** Recording cap in seconds. */
  recordMaxSeconds: number
  /** Submit transcriptions automatically. */
  recordAutoSubmit: boolean
  /** Whether silence auto-end (VAD) is enabled. */
  vadEnabled: boolean
  /** Consecutive silence before the recording auto-ends (ms). */
  vadSilenceMs: number
  /** RMS energy floor above which audio counts as speech (0..1). */
  vadEnergyThreshold: number
  /** Resolved STT engine preference. */
  sttEngine: SttEngine
  /** BCP-47 language or "auto". */
  sttLanguage: string
  /** Show interim transcriptions. */
  sttInterim: boolean
  /** Silence window in ms before continuous dictation auto-finalises. */
  sttSilenceFinaliseMs: number
  /** FunASR inference endpoint, or null. */
  funasrUrl: string | null
  /** FunASR model name, or null for the server default. */
  funasrModel: string | null
  /** whisper.cpp executable. */
  whisperCommand: string
  /** whisper.cpp model path, or null. */
  whisperModelPath: string | null
  /** whisper.cpp language override, or null for the global language. */
  whisperLanguage: string | null
  /** Resolved TTS engine preference. */
  ttsEngine: TtsEngine
  /** Voice override, or null for the engine default. */
  ttsVoice: string | null
  /** Rate offset in percent for edge-tts/piper/macos. */
  ttsRate: number
  /** Fall back to the browser voice on local-engine failure. */
  ttsFallbackToBrowser: boolean
  /** Preferred browser voice name, or null. */
  browserVoiceName: string | null
  /** SpeechSynthesis rate. */
  browserRate: number
  /** SpeechSynthesis pitch. */
  browserPitch: number
  /** edge-tts executable. */
  edgeTtsCommand: string
  /** edge-tts voice name. */
  edgeTtsVoice: string
  /** macOS `say` executable. */
  macosCommand: string
  /** macOS voice name exactly as `say -v '?'` lists it. */
  macosVoice: string
  /** macOS speech-rate anchor in words per minute. */
  macosRate: number
  /** piper executable. */
  piperCommand: string
  /** piper model path, or null. */
  piperModelPath: string | null
  /** Whether locally synthesized audio is also written to a file. */
  ttsExportEnabled: boolean
  /** Absolute directory exported audio lands in. */
  ttsExportDir: string
  /** Files retained in the export directory. */
  ttsExportMaxFiles: number
  /** Age cap (minutes) for exported audio files. */
  ttsExportMaxAgeMinutes: number
  /** Whether any event announcements are enabled. */
  announceEnabled: boolean
  /** Announce turn completion. */
  announceOnTurnEnd: boolean
  /** Announce pending approvals. */
  announceOnApproval: boolean
  /** Announce errors. */
  announceOnError: boolean
  /** Spoken phrase for turn completion. */
  messageTurnEnd: string
  /** Spoken phrase for approvals. */
  messageApproval: string
  /** Spoken phrase for errors. */
  messageError: string
  /** Whether the assistant's final reply is read aloud automatically. */
  autoReplyEnabled: boolean
  /** Cap on one auto-read utterance in characters. */
  autoReplyMaxChars: number
  /** Skip auto-read when the turn already called the speak tool. */
  autoReplySkipIfToolSpoke: boolean
  /** Never auto-read subagent sessions. */
  autoReplySkipSubagents: boolean
  /** Turn-end reasons that trigger auto-read. */
  autoReplyReasons: readonly AutoReplyReason[]
  /** Whether talking interrupts current playback. */
  interruptEnabled: boolean
  /** Cap on the speak tool's text length. */
  maxSpeakChars: number
  /** In-memory synthesized-audio cache cap in bytes. */
  maxAudioCacheBytes: number
}

/** Schemastery schema for loader-validated configuration. */
export const Config: z<Config> = z.object({
  record: z.object({
    enabled: z.boolean().default(true),
    hotkey: z.union([z.string(), z.const(null)]).default(null),
    maxSeconds: z.number().min(1).max(MAX_RECORD_SECONDS).default(DEFAULT_MAX_RECORD_SECONDS),
    autoSubmit: z.boolean().default(false),
    vad: z.object({
      enabled: z.boolean().default(true),
      silenceMs: z.number().min(200).max(MAX_VAD_SILENCE_MS).default(DEFAULT_VAD_SILENCE_MS),
      energyThreshold: z.number().min(0).max(1).default(DEFAULT_VAD_ENERGY_THRESHOLD),
    }),
  }),
  stt: z.object({
    engine: z.union(['auto', 'web', 'funasr', 'whisper'] as const).default('auto'),
    language: z.string().default('auto'),
    interim: z.boolean().default(true),
    silenceFinaliseMs: z.number().min(500).max(15000).default(DEFAULT_SILENCE_FINALISE_MS),
    funasr: z.object({
      url: z.string(),
      model: z.string(),
    }),
    whisper: z.object({
      command: z.string().default('whisper-cli'),
      modelPath: z.string(),
      language: z.string(),
    }),
  }),
  tts: z.object({
    engine: z.union(['auto', 'browser', 'edge-tts', 'macos', 'piper'] as const).default('auto'),
    voice: z.string(),
    rate: z.number().min(-50).max(50).default(0),
    fallbackToBrowser: z.boolean().default(true),
    browser: z.object({
      voiceName: z.string(),
      rate: z.number().min(0.1).max(10).default(1),
      pitch: z.number().min(0).max(2).default(1),
    }),
    edgeTts: z.object({
      command: z.string().default('edge-tts'),
      voice: z.string().default('en-US-JennyNeural'),
    }),
    piper: z.object({
      command: z.string().default('piper'),
      modelPath: z.string(),
    }),
    macos: z.object({
      command: z.string().default(DEFAULT_MACOS_COMMAND),
      voice: z.string().default(DEFAULT_MACOS_VOICE),
      rate: z.number().min(MIN_MACOS_RATE).max(MAX_MACOS_RATE).default(DEFAULT_MACOS_RATE),
    }),
    export: z.object({
      enabled: z.boolean().default(true),
      // Empty = the plugin's own default directory (never the workspace root).
      dir: z.string().default(''),
      maxFiles: z.number().min(1).max(MAX_EXPORT_MAX_FILES).default(DEFAULT_EXPORT_MAX_FILES),
      maxAgeMinutes: z.number().min(1).max(MAX_EXPORT_MAX_AGE_MINUTES).default(DEFAULT_EXPORT_MAX_AGE_MINUTES),
    }),
  }),
  announce: z.object({
    enabled: z.boolean().default(true),
    onTurnEnd: z.boolean().default(true),
    onApproval: z.boolean().default(true),
    onError: z.boolean().default(true),
    messages: z.object({
      turnEnd: z.string().default('Turn complete.'),
      approval: z.string().default('Approval required.'),
      error: z.string().default('Something went wrong.'),
    }),
  }),
  autoReply: z.object({
    enabled: z.boolean().default(true),
    maxChars: z.number().min(1).max(MAX_AUTO_REPLY_MAX_CHARS).default(DEFAULT_AUTO_REPLY_MAX_CHARS),
    skipIfToolSpoke: z.boolean().default(true),
    skipSubagents: z.boolean().default(true),
    reasons: z.array(z.union(['completed', 'max-tokens'] as const)).default(['completed', 'max-tokens']),
  }),
  interrupt: z.boolean().default(true),
  maxSpeakChars: z.number().min(1).max(MAX_SPEAK_CHARS).default(DEFAULT_MAX_SPEAK_CHARS),
  maxAudioCacheBytes: z.number().min(1024 * 1024).max(MAX_AUDIO_CACHE_BYTES).default(DEFAULT_MAX_AUDIO_CACHE_BYTES),
})

const STT_ENGINES = ['auto', 'web', 'funasr', 'whisper'] as const
const TTS_ENGINES = ['auto', 'browser', 'edge-tts', 'macos', 'piper'] as const
const AUTO_REPLY_REASONS = ['completed', 'max-tokens'] as const

function isSttEngine(value: unknown): value is SttEngine {
  return typeof value === 'string' && (STT_ENGINES as readonly string[]).includes(value)
}

function isTtsEngine(value: unknown): value is TtsEngine {
  return typeof value === 'string' && (TTS_ENGINES as readonly string[]).includes(value)
}

function isAutoReplyReason(value: unknown): value is AutoReplyReason {
  return typeof value === 'string' && (AUTO_REPLY_REASONS as readonly string[]).includes(value)
}

function stringOf(value: unknown, fallback: string, label: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw new TypeError(`dsh-talk: config.${label} must be a string`)
  return value
}

function nullableStringOf(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new TypeError(`dsh-talk: config.${label} must be a string or null`)
  return value
}

/**
 * Resolve an optional path/name where an EMPTY string means "not configured".
 * The Schemastery schema carries plain `z.string()` leaf defaults (`''`) for
 * optional engine paths, so treating `''` as a set value made `auto` select an
 * engine with no model/endpoint and fail at the first utterance.
 *
 * @param value - raw config leaf.
 * @param label - config path for the error message.
 * @returns the non-empty string, or null for absent/empty.
 */
function nullableNonEmptyStringOf(value: unknown, label: string): string | null {
  const text = nullableStringOf(value, label)
  return text === null || text === '' ? null : text
}

function booleanOf(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`dsh-talk: config.${label} must be a boolean`)
  return value
}

function numberOf(value: unknown, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`dsh-talk: config.${label} must be a finite number between ${min} and ${max}`)
  }
  return value as number
}

/**
 * Resolve the auto-read reason whitelist: at least one entry, each value from
 * the closed vocabulary. The array is copied and frozen so a programmatic
 * caller's later mutation cannot silently change a live controller's policy.
 *
 * @param value - raw `autoReply.reasons` (undefined for the default).
 * @returns the frozen reason list.
 */
function autoReplyReasonsOf(value: unknown): readonly AutoReplyReason[] {
  if (value === undefined) return DEFAULT_AUTO_REPLY_REASONS
  if (!Array.isArray(value)) {
    throw new TypeError('dsh-talk: config.autoReply.reasons must be an array of "completed" | "max-tokens"')
  }
  const reasons: AutoReplyReason[] = []
  for (const candidate of value) {
    if (!isAutoReplyReason(candidate)) {
      throw new Error(`dsh-talk: config.autoReply.reasons must contain only "completed" | "max-tokens", got ${JSON.stringify(candidate)}`)
    }
    reasons.push(candidate)
  }
  if (reasons.length === 0) {
    throw new Error('dsh-talk: config.autoReply.reasons must contain at least one reason')
  }
  return Object.freeze(reasons)
}

/**
 * Resolve raw config to the runtime policy, re-validating defaults and bounds.
 * Cross-field consistency (an engine that requires a model path or endpoint)
 * fails here too, so a misconfigured row is loud at load instead of failing
 * on the first utterance.
 *
 * @param config - raw loader config; `undefined` for a bare row.
 * @returns the frozen resolved config.
 */
export function resolveConfig(config: Config | undefined): ResolvedConfig {
  const record = config?.record ?? {}
  const stt = config?.stt ?? {}
  const tts = config?.tts ?? {}
  const announce = config?.announce ?? {}
  const messages = announce.messages ?? {}
  const autoReply = config?.autoReply ?? {}

  const recordEnabled = booleanOf(record.enabled, true, 'record.enabled')
  const recordHotkey = nullableStringOf(record.hotkey, 'record.hotkey')
  if (recordHotkey !== null && recordHotkey.length > 40) {
    throw new Error('dsh-talk: config.record.hotkey must be at most 40 characters')
  }
  const recordMaxSeconds = numberOf(record.maxSeconds, DEFAULT_MAX_RECORD_SECONDS, 1, MAX_RECORD_SECONDS, 'record.maxSeconds')
  const recordAutoSubmit = booleanOf(record.autoSubmit, false, 'record.autoSubmit')

  const vadEnabled = booleanOf(record.vad?.enabled, true, 'record.vad.enabled')
  const vadSilenceMs = numberOf(record.vad?.silenceMs, DEFAULT_VAD_SILENCE_MS, 200, MAX_VAD_SILENCE_MS, 'record.vad.silenceMs')
  const vadEnergyThreshold = numberOf(record.vad?.energyThreshold, DEFAULT_VAD_ENERGY_THRESHOLD, 0, 1, 'record.vad.energyThreshold')

  const sttEngineRaw = stt.engine ?? 'auto'
  if (!isSttEngine(sttEngineRaw)) {
    throw new Error(`dsh-talk: config.stt.engine must be one of "auto", "web", "funasr", "whisper", got ${JSON.stringify(sttEngineRaw)}`)
  }
  const sttLanguage = stringOf(stt.language, 'auto', 'stt.language')
  if (sttLanguage !== 'auto' && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(sttLanguage)) {
    throw new Error(`dsh-talk: config.stt.language must be "auto" or a BCP-47 tag, got ${JSON.stringify(sttLanguage)}`)
  }
  const sttInterim = booleanOf(stt.interim, true, 'stt.interim')
  const sttSilenceFinaliseMs = numberOf(stt.silenceFinaliseMs, DEFAULT_SILENCE_FINALISE_MS, 500, 15000, 'stt.silenceFinaliseMs')

  const funasrUrl = nullableNonEmptyStringOf(stt.funasr?.url, 'stt.funasr.url')
  const funasrModel = nullableNonEmptyStringOf(stt.funasr?.model, 'stt.funasr.model')
  const whisperCommand = stringOf(stt.whisper?.command, 'whisper-cli', 'stt.whisper.command')
  if (whisperCommand.length === 0) throw new Error('dsh-talk: config.stt.whisper.command must not be empty')
  const whisperModelPath = nullableNonEmptyStringOf(stt.whisper?.modelPath, 'stt.whisper.modelPath')
  const whisperLanguage = nullableNonEmptyStringOf(stt.whisper?.language, 'stt.whisper.language')

  const ttsEngineRaw = tts.engine ?? 'auto'
  if (!isTtsEngine(ttsEngineRaw)) {
    throw new Error(`dsh-talk: config.tts.engine must be one of "auto", "browser", "edge-tts", "macos", "piper", got ${JSON.stringify(ttsEngineRaw)}`)
  }
  const ttsVoice = nullableNonEmptyStringOf(tts.voice, 'tts.voice')
  const ttsRate = numberOf(tts.rate, 0, -50, 50, 'tts.rate')
  const ttsFallbackToBrowser = booleanOf(tts.fallbackToBrowser, true, 'tts.fallbackToBrowser')
  const browserVoiceName = nullableNonEmptyStringOf(tts.browser?.voiceName, 'tts.browser.voiceName')
  const browserRate = numberOf(tts.browser?.rate, 1, 0.1, 10, 'tts.browser.rate')
  const browserPitch = numberOf(tts.browser?.pitch, 1, 0, 2, 'tts.browser.pitch')
  const edgeTtsCommand = stringOf(tts.edgeTts?.command, 'edge-tts', 'tts.edgeTts.command')
  if (edgeTtsCommand.length === 0) throw new Error('dsh-talk: config.tts.edgeTts.command must not be empty')
  const edgeTtsVoice = stringOf(tts.edgeTts?.voice, 'en-US-JennyNeural', 'tts.edgeTts.voice')
  const piperCommand = stringOf(tts.piper?.command, 'piper', 'tts.piper.command')
  if (piperCommand.length === 0) throw new Error('dsh-talk: config.tts.piper.command must not be empty')
  const piperModelPath = nullableNonEmptyStringOf(tts.piper?.modelPath, 'tts.piper.modelPath')
  const macosCommand = stringOf(tts.macos?.command, DEFAULT_MACOS_COMMAND, 'tts.macos.command')
  if (macosCommand.length === 0) throw new Error('dsh-talk: config.tts.macos.command must not be empty')
  const macosVoice = stringOf(tts.macos?.voice, DEFAULT_MACOS_VOICE, 'tts.macos.voice')
  if (macosVoice.trim().length === 0) throw new Error('dsh-talk: config.tts.macos.voice must not be empty')
  const macosRate = numberOf(tts.macos?.rate, DEFAULT_MACOS_RATE, MIN_MACOS_RATE, MAX_MACOS_RATE, 'tts.macos.rate')
  const ttsExportEnabled = booleanOf(tts.export?.enabled, true, 'tts.export.enabled')
  const ttsExportDir = resolveExportDir(tts.export?.dir)
  const ttsExportMaxFiles = numberOf(
    tts.export?.maxFiles,
    DEFAULT_EXPORT_MAX_FILES,
    1,
    MAX_EXPORT_MAX_FILES,
    'tts.export.maxFiles',
  )
  const ttsExportMaxAgeMinutes = numberOf(
    tts.export?.maxAgeMinutes,
    DEFAULT_EXPORT_MAX_AGE_MINUTES,
    1,
    MAX_EXPORT_MAX_AGE_MINUTES,
    'tts.export.maxAgeMinutes',
  )

  // Cross-field consistency: an engine the user explicitly selected must be
  // fully addressable, or the row fails at load instead of at first use.
  if (sttEngineRaw === 'funasr' && funasrUrl === null) {
    throw new Error('dsh-talk: config.stt.engine is "funasr" but config.stt.funasr.url is not set')
  }
  if (sttEngineRaw === 'whisper' && whisperModelPath === null) {
    throw new Error('dsh-talk: config.stt.engine is "whisper" but config.stt.whisper.modelPath is not set')
  }
  if (ttsEngineRaw === 'piper' && piperModelPath === null) {
    throw new Error('dsh-talk: config.tts.engine is "piper" but config.tts.piper.modelPath is not set')
  }

  const announceEnabled = booleanOf(announce.enabled, DEFAULT_ANNOUNCE_ENABLED, 'announce.enabled')
  const announceOnTurnEnd = booleanOf(announce.onTurnEnd, true, 'announce.onTurnEnd')
  const announceOnApproval = booleanOf(announce.onApproval, true, 'announce.onApproval')
  const announceOnError = booleanOf(announce.onError, true, 'announce.onError')
  const messageTurnEnd = stringOf(messages.turnEnd, 'Turn complete.', 'announce.messages.turnEnd')
  const messageApproval = stringOf(messages.approval, 'Approval required.', 'announce.messages.approval')
  const messageError = stringOf(messages.error, 'Something went wrong.', 'announce.messages.error')

  const autoReplyEnabled = booleanOf(autoReply.enabled, true, 'autoReply.enabled')
  const autoReplyMaxChars = numberOf(autoReply.maxChars, DEFAULT_AUTO_REPLY_MAX_CHARS, 1, MAX_AUTO_REPLY_MAX_CHARS, 'autoReply.maxChars')
  const autoReplySkipIfToolSpoke = booleanOf(autoReply.skipIfToolSpoke, true, 'autoReply.skipIfToolSpoke')
  const autoReplySkipSubagents = booleanOf(autoReply.skipSubagents, true, 'autoReply.skipSubagents')
  const autoReplyReasons = autoReplyReasonsOf(autoReply.reasons)

  const interruptEnabled = booleanOf(config?.interrupt, true, 'interrupt')
  const maxSpeakChars = numberOf(config?.maxSpeakChars, DEFAULT_MAX_SPEAK_CHARS, 1, MAX_SPEAK_CHARS, 'maxSpeakChars')
  const maxAudioCacheBytes = numberOf(
    config?.maxAudioCacheBytes,
    DEFAULT_MAX_AUDIO_CACHE_BYTES,
    1024 * 1024,
    MAX_AUDIO_CACHE_BYTES,
    'maxAudioCacheBytes',
  )

  return Object.freeze({
    recordEnabled,
    recordHotkey,
    recordMaxSeconds,
    recordAutoSubmit,
    vadEnabled,
    vadSilenceMs,
    vadEnergyThreshold,
    sttEngine: sttEngineRaw,
    sttLanguage,
    sttInterim,
    sttSilenceFinaliseMs,
    funasrUrl,
    funasrModel,
    whisperCommand,
    whisperModelPath,
    whisperLanguage,
    ttsEngine: ttsEngineRaw,
    ttsVoice,
    ttsRate,
    ttsFallbackToBrowser,
    browserVoiceName,
    browserRate,
    browserPitch,
    edgeTtsCommand,
    edgeTtsVoice,
    macosCommand,
    macosVoice,
    macosRate,
    piperCommand,
    piperModelPath,
    ttsExportEnabled,
    ttsExportDir,
    ttsExportMaxFiles,
    ttsExportMaxAgeMinutes,
    announceEnabled,
    announceOnTurnEnd,
    announceOnApproval,
    announceOnError,
    messageTurnEnd,
    messageApproval,
    messageError,
    autoReplyEnabled,
    autoReplyMaxChars,
    autoReplySkipIfToolSpoke,
    autoReplySkipSubagents,
    autoReplyReasons,
    interruptEnabled,
    maxSpeakChars,
    maxAudioCacheBytes,
  })
}
