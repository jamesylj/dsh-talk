/**
 * `android` branch configuration: MiniMax cloud TTS only.
 *
 * The Android build of DeepSeek Harness has no Apple-silicon MLX runtime and no
 * local audio player on the host, so exactly one engine remains: the MiniMax
 * synchronous T2A endpoint. Audio is synthesized on the host and handed to the
 * Web UI, which plays it in the WebView. `resolveConfig` re-judges every default
 * and bound so programmatic construction fails loud instead of running with
 * hidden defaults.
 *
 * @module dsh-talk/config
 */

import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Default speak-tool text cap in characters. */
export const DEFAULT_MAX_SPEAK_CHARS = 20_000

/** Ceiling for one speak request. */
export const MAX_SPEAK_CHARS = 100_000

/** Default cap on one auto-read utterance in characters. */
export const DEFAULT_AUTO_REPLY_MAX_CHARS = 600

/** Ceiling for one auto-read utterance (the speak tool's ceiling). */
export const MAX_AUTO_REPLY_MAX_CHARS = 100_000

/** Default MiniMax synchronous T2A endpoint. */
export const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.cn/v1/t2a_v2'

/** Default MiniMax speech model (fastest T2A tier). */
export const DEFAULT_MINIMAX_MODEL = 'speech-2.8-turbo'

/** Default MiniMax Mandarin voice (温暖少女). */
export const DEFAULT_MINIMAX_VOICE = 'Chinese (Mandarin)_Warm_Girl'

/** Default MiniMax batch size in characters (the API accepts < 10,000). */
export const DEFAULT_MINIMAX_BATCH_CHARS = 2_000

/** Lower bound for the MiniMax batch size. */
export const MIN_MINIMAX_BATCH_CHARS = 500

/** Upper bound for the MiniMax batch size. */
export const MAX_MINIMAX_BATCH_CHARS = 10_000

/** Default per-request idle timeout for one MiniMax batch (ms). */
export const DEFAULT_MINIMAX_REQUEST_TIMEOUT_MS = 120_000

/** Lower bound for the MiniMax idle timeout. */
export const MIN_MINIMAX_REQUEST_TIMEOUT_MS = 5_000

/** Upper bound for the MiniMax idle timeout. */
export const MAX_MINIMAX_REQUEST_TIMEOUT_MS = 600_000

/** Default environment variable holding the MiniMax API key. */
export const DEFAULT_MINIMAX_API_KEY_ENV = 'MINIMAX_CN_API_KEY'

/** Default harness credential store consulted when the environment variable is unset. */
export const DEFAULT_MINIMAX_CREDENTIALS_FILE = join(homedir(), '.dsh', '.credentials.yaml')

/** MiniMax engine configuration. */
export interface TtsMinimaxConfig {
  /** Environment variable holding the API key (default "MINIMAX_CN_API_KEY"). */
  apiKeyEnv?: string
  /** Harness credential store read as a fallback (`refs:` section); "" disables the fallback. */
  credentialsFile?: string
  /** Synchronous T2A endpoint (default "https://api.minimax.cn/v1/t2a_v2"). */
  baseUrl?: string
  /** Model id (default "speech-2.8-turbo"). */
  model?: string
  /** System voice id (default "Chinese (Mandarin)_Warm_Girl"). */
  voiceId?: string
  /** Characters per API request; longer text splits at sentence boundaries (default 2000, 500..10000). */
  chunkChars?: number
  /** Idle timeout: no network progress for this long fails the utterance (default 120000). */
  requestTimeoutMs?: number
}

/** Text-to-speech configuration. */
export interface TtsConfig {
  /** MiniMax cloud TTS (speech-2.8-turbo); needs an API key. */
  minimax?: TtsMinimaxConfig
}

/** Event announcement configuration. */
export interface AnnounceConfig {
  /** Speak the generic "Turn complete." line when a turn does not auto-read (default true). */
  enabled?: boolean
}

/** Automatic reply read-aloud configuration. */
export interface AutoReplyConfig {
  /** Read the assistant's final reply of a completed turn aloud (default true). */
  enabled?: boolean
  /** Cap on one auto-read utterance in characters (default 600). */
  maxChars?: number
}

/** Raw loader configuration (Schemastery-validated, optional leaves). */
export interface Config {
  /** Text-to-speech. */
  tts?: TtsConfig
  /** Turn-end announcement. */
  announce?: AnnounceConfig
  /** Automatic reply read-aloud. */
  autoReply?: AutoReplyConfig
  /** Cap on the speak tool's text length (default 20000). */
  maxSpeakChars?: number
}

/** Fully resolved runtime policy. */
export interface ResolvedConfig {
  /** Environment variable consulted for the MiniMax API key. */
  minimaxApiKeyEnv: string
  /** Harness credential store read for the MiniMax key, or null when disabled. */
  minimaxCredentialsFile: string | null
  /** MiniMax T2A endpoint. */
  minimaxBaseUrl: string
  /** MiniMax model id. */
  minimaxModel: string
  /** MiniMax system voice id. */
  minimaxVoiceId: string
  /** Characters per MiniMax API request. */
  minimaxChunkChars: number
  /** Idle timeout for one MiniMax batch (ms). */
  minimaxRequestTimeoutMs: number
  /** Whether the generic turn-end announcement is enabled. */
  announceEnabled: boolean
  /** Whether the assistant's final reply is read aloud automatically. */
  autoReplyEnabled: boolean
  /** Cap on one auto-read utterance in characters. */
  autoReplyMaxChars: number
  /** Cap on the speak tool's text length. */
  maxSpeakChars: number
}

/** Schemastery schema for loader-validated configuration. */
export const Config: z<Config> = z.object({
  tts: z.object({
    minimax: z.object({
      apiKeyEnv: z.string().default(DEFAULT_MINIMAX_API_KEY_ENV),
      credentialsFile: z.string().default(DEFAULT_MINIMAX_CREDENTIALS_FILE),
      baseUrl: z.string().default(DEFAULT_MINIMAX_BASE_URL),
      model: z.string().default(DEFAULT_MINIMAX_MODEL),
      voiceId: z.string().default(DEFAULT_MINIMAX_VOICE),
      chunkChars: z.number().min(MIN_MINIMAX_BATCH_CHARS).max(MAX_MINIMAX_BATCH_CHARS).default(DEFAULT_MINIMAX_BATCH_CHARS),
      requestTimeoutMs: z.number().min(MIN_MINIMAX_REQUEST_TIMEOUT_MS).max(MAX_MINIMAX_REQUEST_TIMEOUT_MS).default(DEFAULT_MINIMAX_REQUEST_TIMEOUT_MS),
    }),
  }),
  announce: z.object({
    enabled: z.boolean().default(true),
  }),
  autoReply: z.object({
    enabled: z.boolean().default(true),
    maxChars: z.number().min(1).max(MAX_AUTO_REPLY_MAX_CHARS).default(DEFAULT_AUTO_REPLY_MAX_CHARS),
  }),
  maxSpeakChars: z.number().min(1).max(MAX_SPEAK_CHARS).default(DEFAULT_MAX_SPEAK_CHARS),
})

function stringOf(value: unknown, fallback: string, field: string): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new Error(`dsh-talk: config.${field} must be a string`)
  return value
}

function nonEmptyStringOf(value: unknown, fallback: string, field: string): string {
  const text = stringOf(value, fallback, field)
  if (text.trim().length === 0) throw new Error(`dsh-talk: config.${field} must not be empty`)
  return text
}

function booleanOf(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') throw new Error(`dsh-talk: config.${field} must be a boolean`)
  return value
}

function numberOf(value: unknown, fallback: number, min: number, max: number, field: string): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`dsh-talk: config.${field} must be a finite number`)
  }
  if (value < min || value > max) {
    throw new Error(`dsh-talk: config.${field} must be between ${min} and ${max}, got ${value}`)
  }
  return value
}

/**
 * Resolve one loader config into the runtime policy: every default is re-judged
 * and every bound re-checked.
 *
 * @param config - raw loader config.
 * @returns the frozen resolved policy.
 */
export function resolveConfig(config?: Config): ResolvedConfig {
  const minimax = config?.tts?.minimax ?? {}
  const announce = config?.announce ?? {}
  const autoReply = config?.autoReply ?? {}

  const minimaxApiKeyEnv = nonEmptyStringOf(minimax.apiKeyEnv, DEFAULT_MINIMAX_API_KEY_ENV, 'tts.minimax.apiKeyEnv')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(minimaxApiKeyEnv)) {
    throw new Error(`dsh-talk: config.tts.minimax.apiKeyEnv must be a shell identifier, got ${JSON.stringify(minimaxApiKeyEnv)}`)
  }
  const credentialsRaw = stringOf(minimax.credentialsFile, DEFAULT_MINIMAX_CREDENTIALS_FILE, 'tts.minimax.credentialsFile')
  const minimaxCredentialsFile = credentialsRaw === ''
    ? null
    : credentialsRaw.startsWith('~/')
      ? join(homedir(), credentialsRaw.slice(2))
      : credentialsRaw
  const minimaxBaseUrl = nonEmptyStringOf(minimax.baseUrl, DEFAULT_MINIMAX_BASE_URL, 'tts.minimax.baseUrl')
  if (!/^https?:\/\//u.test(minimaxBaseUrl)) {
    throw new Error(`dsh-talk: config.tts.minimax.baseUrl must be an http(s) URL, got ${JSON.stringify(minimaxBaseUrl)}`)
  }
  const minimaxModel = nonEmptyStringOf(minimax.model, DEFAULT_MINIMAX_MODEL, 'tts.minimax.model')
  const minimaxVoiceId = nonEmptyStringOf(minimax.voiceId, DEFAULT_MINIMAX_VOICE, 'tts.minimax.voiceId')
  const minimaxChunkChars = numberOf(
    minimax.chunkChars,
    DEFAULT_MINIMAX_BATCH_CHARS,
    MIN_MINIMAX_BATCH_CHARS,
    MAX_MINIMAX_BATCH_CHARS,
    'tts.minimax.chunkChars',
  )
  const minimaxRequestTimeoutMs = numberOf(
    minimax.requestTimeoutMs,
    DEFAULT_MINIMAX_REQUEST_TIMEOUT_MS,
    MIN_MINIMAX_REQUEST_TIMEOUT_MS,
    MAX_MINIMAX_REQUEST_TIMEOUT_MS,
    'tts.minimax.requestTimeoutMs',
  )

  const announceEnabled = booleanOf(announce.enabled, true, 'announce.enabled')
  const autoReplyEnabled = booleanOf(autoReply.enabled, true, 'autoReply.enabled')
  const autoReplyMaxChars = numberOf(
    autoReply.maxChars,
    DEFAULT_AUTO_REPLY_MAX_CHARS,
    1,
    MAX_AUTO_REPLY_MAX_CHARS,
    'autoReply.maxChars',
  )
  const maxSpeakChars = numberOf(config?.maxSpeakChars, DEFAULT_MAX_SPEAK_CHARS, 1, MAX_SPEAK_CHARS, 'maxSpeakChars')

  return Object.freeze({
    minimaxApiKeyEnv,
    minimaxCredentialsFile,
    minimaxBaseUrl,
    minimaxModel,
    minimaxVoiceId,
    minimaxChunkChars,
    minimaxRequestTimeoutMs,
    announceEnabled,
    autoReplyEnabled,
    autoReplyMaxChars,
    maxSpeakChars,
  })
}
