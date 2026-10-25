/**
 * MiniMax cloud speech engine (`speech-2.8-turbo`) over the synchronous T2A
 * HTTP endpoint — the only engine in the `android` branch.
 *
 * The endpoint streams hex-encoded MP3 chunks over Server-Sent Events
 * (`stream: true`). The Android runtime has no local audio player on the host,
 * so this engine simply collects the MP3 and hands it to the talk service,
 * which queues it for the Web UI to play in the WebView. Splitting long text
 * into batched requests and concatenating the audio keeps one continuous
 * utterance.
 *
 * Credentials resolve per utterance: `$<apiKeyEnv>`, then the harness
 * credential store (`refs:` in `~/.dsh/.credentials.yaml`). The key is never
 * logged.
 *
 * @module dsh-talk/minimax
 */

import { readFile } from 'node:fs/promises'
import type { ResolvedConfig } from './config.ts'
import { EngineFailure } from './engine.ts'
import { sanitizeText } from './sanitize.ts'

/**
 * Safety cap on one utterance's accumulated MP3 bytes. The audio crosses the
 * Remote channel as base64, so keep it well below WebSocket message limits:
 * 16 MiB ≈ 17 minutes at 128 kbps.
 */
export const MINIMAX_MAX_AUDIO_BYTES = 16 * 1024 * 1024

/** Largest accepted SSE line (a single hex chunk) before the stream is treated as broken. */
const MINIMAX_MAX_SSE_LINE = 96 * 1024 * 1024

/** Preferred cut points when one request would exceed the API text limit. */
const BATCH_BOUNDARY = /[。！？!?；;…\n]/u

/** Fixed output format of the streaming API (MP3 in, MP3 out). */
const MINIMAX_SAMPLE_RATE = 32_000

/** Fixed language boost for the Mandarin voices this engine ships with. */
const MINIMAX_LANGUAGE_BOOST = 'Chinese'

/** Outcome of one MiniMax synthesis. */
export interface MinimaxSynthResult {
  /** MIME type of the produced audio. */
  mime: 'audio/mpeg'
  /** The complete MP3 bytes. */
  data: Uint8Array
  /** Audio duration in seconds (from the API's `extra_info`). */
  audioSec: number
}

/** One decoded SSE event; `null` fields mean "not present in this event". */
export interface MinimaxSseEvent {
  /** API event status: 1 = audio chunk, 2 = final summary. */
  status: number
  /** Decoded MP3 chunk, when the event carries one. */
  audio: Uint8Array | null
  /** Total batch audio duration in milliseconds (final event only). */
  audioLengthMs: number | null
  /** Billed characters reported by the final event. */
  usageCharacters: number | null
  /** `base_resp.status_code`; 0 on success. */
  errorCode: number | null
  /** `base_resp.status_msg`. */
  errorMessage: string | null
}

/**
 * Split text into API-sized batches without cutting mid-sentence when a
 * boundary is available in the second half of the window.
 *
 * @param text - text to split.
 * @param maxChars - maximum characters per batch.
 * @returns one or more non-empty batches whose concatenation is `text`.
 */
export function splitMinimaxText(text: string, maxChars: number): readonly string[] {
  const limit = Math.max(1, Math.floor(maxChars))
  if (text.length <= limit) return text.length === 0 ? [] : [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = -1
    const floor = Math.floor(limit / 2)
    for (let index = limit; index > floor; index -= 1) {
      const char = rest[index - 1]
      if (char !== undefined && BATCH_BOUNDARY.test(char)) {
        cut = index
        break
      }
    }
    if (cut <= 0) {
      const newline = rest.lastIndexOf('\n', limit - 1)
      cut = newline > 0 ? newline + 1 : limit
    }
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.length > 0) chunks.push(rest)
  return chunks
}

/**
 * Build the T2A request body for one batch.
 *
 * @param resolved - resolved plugin config.
 * @param text - batch text.
 * @param voiceId - voice id (tool override or the configured id).
 * @param stream - whether to ask for SSE streaming.
 * @returns the JSON body.
 */
export function minimaxRequestBody(
  resolved: ResolvedConfig,
  text: string,
  voiceId: string,
  stream: boolean,
): Record<string, unknown> {
  return {
    model: resolved.minimaxModel,
    text,
    stream,
    voice_setting: {
      voice_id: voiceId,
      speed: 1,
      vol: 1,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: MINIMAX_SAMPLE_RATE,
      bitrate: 128_000,
      format: 'mp3',
      channel: 1,
    },
    language_boost: MINIMAX_LANGUAGE_BOOST,
    // Basic rule-based normalization reads numbers/dates better; the `quality`
    // mode is non-streaming only, so `basic` is the correct streaming choice.
    text_normalization_mode: 'basic',
    subtitle_enable: false,
    aigc_watermark: false,
  }
}

/**
 * Decode one `data: {...}` SSE line.
 *
 * @param line - raw line from the event stream.
 * @returns the decoded event, or null for blank lines, `[DONE]`, or malformed JSON.
 */
export function parseMinimaxSseLine(line: string): MinimaxSseEvent | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (payload === '' || payload === '[DONE]') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const root = parsed as Record<string, unknown>
  const base = isRecord(root['base_resp']) ? root['base_resp'] : {}
  const data = isRecord(root['data']) ? root['data'] : {}
  const extra = isRecord(root['extra_info']) ? root['extra_info'] : {}
  const status = typeof data['status'] === 'number' ? data['status'] : 0
  const hex = typeof data['audio'] === 'string' ? data['audio'] : ''
  let audio: Uint8Array | null = null
  if (hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-f]+$/iu.test(hex)) {
    audio = Uint8Array.from(Buffer.from(hex, 'hex'))
  }
  return {
    status,
    audio,
    audioLengthMs: typeof extra['audio_length'] === 'number' ? extra['audio_length'] : null,
    usageCharacters: typeof extra['usage_characters'] === 'number' ? extra['usage_characters'] : null,
    errorCode: typeof base['status_code'] === 'number' ? base['status_code'] : null,
    errorMessage: typeof base['status_msg'] === 'string' ? base['status_msg'] : null,
  }
}

/**
 * Parse the `refs:` section of the harness credential store
 * (`~/.dsh/.credentials.yaml`): two-space-indented `NAME: value` pairs whose
 * values may be single- or double-quoted.
 *
 * @param yaml - file contents.
 * @returns reference name → value.
 */
export function parseCredentialRefs(yaml: string): Record<string, string> {
  const refs: Record<string, string> = {}
  let inRefs = false
  for (const raw of yaml.split(/\r?\n/u)) {
    if (/^refs:\s*$/u.test(raw)) {
      inRefs = true
      continue
    }
    if (!inRefs) continue
    if (/^\S/u.test(raw)) break
    const match = /^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/u.exec(raw)
    if (match?.[1] === undefined) continue
    let value = match[2] ?? ''
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (value !== '') refs[match[1]] = value
  }
  return refs
}

/**
 * Resolve the API key for one synthesis attempt: the environment variable
 * named by `tts.minimax.apiKeyEnv`, then the harness credential store. Never
 * cached across utterances, so a key set while the profile runs reaches the
 * next utterance.
 *
 * @param resolved - resolved plugin config.
 * @returns the key, or null when nothing is configured.
 */
export async function resolveMinimaxApiKey(resolved: ResolvedConfig): Promise<string | null> {
  const envValue = process.env[resolved.minimaxApiKeyEnv]
  if (typeof envValue === 'string' && envValue.trim() !== '') return envValue.trim()
  const file = resolved.minimaxCredentialsFile
  if (file === null) return null
  try {
    const refs = parseCredentialRefs(await readFile(file, 'utf8'))
    const value = refs[resolved.minimaxApiKeyEnv]
    return value === undefined || value === '' ? null : value
  } catch {
    return null
  }
}

/** Narrow an unknown value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * MiniMax T2A engine: streams SSE MP3 chunks for each batch, concatenates them
 * into one utterance, and returns the complete MP3 for the client to play.
 */
export class MinimaxEngine {
  /**
   * @param resolved - resolved plugin config.
   */
  constructor(private readonly resolved: ResolvedConfig) {}

  /**
   * Synthesize one utterance.
   *
   * @param text - sanitized text to speak.
   * @param signal - caller abort signal (interruption).
   * @returns the complete MP3 bytes and its duration.
   */
  async synthesize(text: string, signal: AbortSignal): Promise<MinimaxSynthResult> {
    if (signal.aborted) throw new EngineFailure('minimax: interrupted before synthesis', true)
    const apiKey = await resolveMinimaxApiKey(this.resolved)
    if (apiKey === null) {
      throw new EngineFailure(
        `minimax: no API key; set $${this.resolved.minimaxApiKeyEnv} (or the harness credential store's refs: section)`,
        false,
      )
    }
    const voiceId = this.resolved.minimaxVoiceId
    const batches = splitMinimaxText(text, this.resolved.minimaxChunkChars)
    if (batches.length === 0) throw new EngineFailure('minimax: text is empty', false)
    const pieces: Uint8Array[] = []
    let total = 0
    let audioSec = 0
    const onAudio = async (chunk: Uint8Array): Promise<void> => {
      total += chunk.byteLength
      if (total > MINIMAX_MAX_AUDIO_BYTES) {
        throw new EngineFailure(`minimax: synthesized audio exceeds the ${MINIMAX_MAX_AUDIO_BYTES} byte cap`, false)
      }
      pieces.push(chunk)
    }
    for (const batch of batches) {
      if (signal.aborted) throw new EngineFailure('minimax: interrupted', true)
      audioSec += await this.collectBatch(batch, voiceId, apiKey, signal, onAudio)
    }
    const data = this.concat(pieces)
    return {
      mime: 'audio/mpeg',
      data,
      audioSec: audioSec > 0 ? audioSec : Math.max(0.001, (data.byteLength * 8) / 128_000),
    }
  }

  /** Concatenate the accumulated chunks (a single empty array yields 0 bytes). */
  private concat(pieces: readonly Uint8Array[]): Uint8Array {
    if (pieces.length === 1) return pieces[0] as Uint8Array
    return Uint8Array.from(Buffer.concat(pieces.map(piece => Buffer.from(piece))))
  }

  /** Reject with a classified interruption when the caller's signal fired. */
  private interruption(signal: AbortSignal): EngineFailure {
    return new EngineFailure('minimax: interrupted', signal.aborted)
  }

  /** Describe one failure without leaking the key or raw payloads. */
  private failure(message: string, signal: AbortSignal): EngineFailure {
    return new EngineFailure(`minimax: ${sanitizeText(message, 400)}`, signal.aborted)
  }

  /**
   * Read one batch's SSE stream, forwarding each audio chunk to `onAudio` and
   * returning the batch's audio duration in seconds.
   */
  private async collectBatch(
    text: string,
    voiceId: string,
    apiKey: string,
    signal: AbortSignal,
    onAudio: (chunk: Uint8Array) => Promise<void>,
  ): Promise<number> {
    // The request timeout is an IDLE budget, not a total one: a long reply is
    // synthesized over many batches, so only a genuine stall fails it.
    const idleMs = this.resolved.minimaxRequestTimeoutMs
    const idle = new AbortController()
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const bump = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => idle.abort(), idleMs)
    }
    bump()
    const combined = AbortSignal.any([signal, idle.signal])
    /** Classify one failure raised while the idle clock was running. */
    const classify = (error: unknown): EngineFailure => {
      if (signal.aborted) return this.interruption(signal)
      if (idle.signal.aborted) return this.failure(`stream stalled for ${Math.round(idleMs / 1000)}s`, signal)
      return this.failure(error instanceof Error ? error.message : String(error), signal)
    }
    const body = JSON.stringify(minimaxRequestBody(this.resolved, text, voiceId, true))
    let response: Response
    try {
      response = await fetch(this.resolved.minimaxBaseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: combined,
      })
    } catch (error) {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      throw classify(error)
    }
    bump()
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw this.failure(`HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`, signal)
    }
    if (response.body === null) throw this.failure('response carried no body', signal)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let seconds = 0
    let sawChunk = false
    let finalAudio: Uint8Array | null = null
    try {
      for (;;) {
        const { value, done } = await reader.read()
        bump()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > MINIMAX_MAX_SSE_LINE && !buffer.includes('\n')) {
          throw this.failure('SSE line exceeds the safety cap', signal)
        }
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          const event = parseMinimaxSseLine(line)
          if (event !== null) {
            if (event.errorCode !== null && event.errorCode !== 0) {
              throw this.failure(`${event.errorCode}: ${event.errorMessage ?? 'request failed'}`, signal)
            }
            if (event.audio !== null && event.audio.byteLength > 0) {
              // The final event repeats the whole batch audio; streaming consumers
              // must use the status-1 chunks (and only fall back to the final
              // payload when the server sent no chunk events at all).
              if (event.status === 2) finalAudio = event.audio
              else {
                sawChunk = true
                await onAudio(event.audio)
                bump()
              }
            }
            if (event.audioLengthMs !== null) seconds += event.audioLengthMs / 1000
          }
          newline = buffer.indexOf('\n')
        }
        if (signal.aborted) throw this.interruption(signal)
      }
      const trailing = buffer.trim()
      if (trailing !== '') {
        const event = parseMinimaxSseLine(trailing)
        if (event?.audioLengthMs != null) seconds += event.audioLengthMs / 1000
      }
    } catch (error) {
      if (error instanceof EngineFailure) throw error
      throw classify(error)
    } finally {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      reader.releaseLock()
    }
    if (!sawChunk && finalAudio !== null) await onAudio(finalAudio)
    if (!sawChunk && finalAudio === null) throw this.failure('response carried no audio', signal)
    return seconds
  }
}
