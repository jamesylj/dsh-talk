/**
 * MLX local TTS engine: one renderer process per utterance.
 *
 * The bundled `worker/mlx_tts.py` loads a quantized Qwen3-TTS model, splits the
 * text on sentence boundaries, synthesizes each chunk, and plays every chunk as
 * soon as it exists through the system player (afplay on macOS). The host waits
 * for the process, then returns the concatenated WAV so the speak pipeline can
 * cache/export/record it like any other local engine. Killing the process
 * (abort signal) stops the active player and exits 143, which the service
 * classifies as `interrupted`.
 *
 * @module dsh-talk/mlx
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ResolvedConfig } from './config.ts'
import { EngineFailure } from './engine.ts'
import { sanitizeText } from './sanitize.ts'

/** One MLX synthesis result. */
export interface MlxSynthResult {
  /** 24 kHz mono WAV bytes (the concatenated full utterance). */
  data: Uint8Array
  /** MIME type of {@link data}. */
  mime: 'audio/wav'
  /** Audio duration printed by the worker, in seconds. */
  audioSec: number
  /** Time from worker start to the first audible chunk (null when unknown). */
  firstAudioSec: number | null
  /** Worker synthesis time (all chunks), in seconds. */
  synthSec: number
}

/** Absolute path of the bundled worker script. */
export function defaultMlxScript(): string {
  return fileURLToPath(new URL('../worker/mlx_tts.py', import.meta.url))
}

/** Stdout/stderr caps for one worker run (progress JSON + failure text). */
const MAX_STDOUT = 256 * 1024
const MAX_STDERR = 64 * 1024

/**
 * Render one utterance with the MLX worker.
 *
 * @param resolved - resolved config (command/model/voice/chunkChars/player).
 * @param text - text to speak (sanitized by the caller).
 * @param signal - abort signal; firing it kills the worker and its player.
 * @param voiceOverride - per-call voice override.
 * @returns the concatenated WAV plus worker timing facts.
 */
export async function synthesizeMlx(
  resolved: ResolvedConfig,
  text: string,
  signal: AbortSignal,
  voiceOverride?: string,
): Promise<MlxSynthResult> {
  if (signal.aborted) throw new EngineFailure('mlx: interrupted before synthesis', true)
  const script = resolved.mlxScript ?? defaultMlxScript()
  const dir = await mkdtemp(join(tmpdir(), 'dsh-talk-mlx-'))
  const outPath = join(dir, 'speech.wav')
  try {
    return await new Promise<MlxSynthResult>((resolve, reject) => {
      const child = spawn(
        resolved.mlxCommand,
        [
          script,
          '--model', resolved.mlxModel,
          '--voice', voiceOverride ?? resolved.mlxVoice,
          '--lang', resolved.mlxLanguage,
          '--chunk-chars', String(resolved.mlxChunkChars),
          '--player', resolved.mlxPlayer,
          '--out', outPath,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1' } },
      )
      let stdout = ''
      let stderr = ''
      let audioSec = 0
      let synthSec = 0
      let firstAudioSec: number | null = null
      let settled = false
      const cap = (current: string, chunk: string, max: number): string => {
        const text = current + chunk
        return text.length > max ? text.slice(0, max) : text
      }
      child.stdout?.on('data', (bytes: Buffer) => {
        const chunk = bytes.toString('utf8')
        stdout = cap(stdout, chunk, MAX_STDOUT)
        for (const line of chunk.split('\n')) {
          if (line.trim() === '') continue
          try {
            const event = JSON.parse(line) as {
              phase?: string
              audioSec?: number
              synthSec?: number
              firstAudioSec?: number | null
            }
            if (event.phase === 'chunk' && typeof event.firstAudioSec === 'number') firstAudioSec = event.firstAudioSec
            if (event.phase === 'done') {
              if (typeof event.audioSec === 'number') audioSec = event.audioSec
              if (typeof event.synthSec === 'number') synthSec = event.synthSec
              if (typeof event.firstAudioSec === 'number') firstAudioSec = event.firstAudioSec
            }
          } catch {
            // A torn/late line is diagnostics only.
          }
        }
      })
      child.stderr?.on('data', (bytes: Buffer) => {
        stderr = cap(stderr, bytes.toString('utf8'), MAX_STDERR)
      })
      const onAbort = (): void => {
        try {
          child.kill('SIGTERM')
        } catch {
          // The worker already exited.
        }
      }
      signal.addEventListener('abort', onAbort, { once: true })
      child.on('error', error => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(new EngineFailure(`mlx failed to start: ${sanitizeText(error.message)}`, signal.aborted))
      })
      child.on('close', (code, exitSignal) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        void (async () => {
          try {
            if (signal.aborted || code === 143 || code === 130 || exitSignal === 'SIGTERM') {
              throw new EngineFailure('mlx: interrupted', true)
            }
            if (code !== 0) {
              throw new EngineFailure(`mlx exited ${String(code)}: ${sanitizeText(stderr)}`, false)
            }
            const data = await readFile(outPath)
            if (data.byteLength === 0) throw new EngineFailure('mlx produced no audio', false)
            resolve({ data, mime: 'audio/wav', audioSec, firstAudioSec, synthSec })
          } catch (error) {
            reject(error)
          } finally {
            await rm(dir, { recursive: true, force: true }).catch(() => {})
          }
        })()
      })
      try {
        child.stdin?.on('error', () => undefined)
        child.stdin?.end(text)
      } catch (error) {
        onAbort()
        if (!settled) {
          settled = true
          signal.removeEventListener('abort', onAbort)
          reject(new EngineFailure(`mlx failed to receive text: ${sanitizeText(error instanceof Error ? error.message : String(error))}`, signal.aborted))
        }
      }
    })
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
