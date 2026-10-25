/**
 * Resident MLX TTS worker client.
 *
 * The bundled `worker/mlx_tts.py` loads a quantized Qwen3-TTS model once and
 * keeps it warm. Each request streams generated fragments into ONE continuous
 * sounddevice output stream (a single player: no per-chunk overlap and no gaps
 * between sentences) and writes the concatenated WAV for the speak pipeline.
 * Requests are serialized; an abort sends `cancel` so the model stays loaded.
 *
 * @module dsh-talk/mlx
 */
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
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
  /** Time from worker request start to the first audible fragment. */
  firstAudioSec: number | null
  /** Worker synthesis time (all chunks), in seconds. */
  synthSec: number
}

/** Absolute path of the bundled worker script. */
export function defaultMlxScript(): string {
  return fileURLToPath(new URL('../worker/mlx_tts.py', import.meta.url))
}

/** One worker stdout line (only the fields this client consumes). */
interface WorkerEvent {
  type?: string
  id?: string
  file?: string
  audioSec?: number
  firstAudioSec?: number
  synthSec?: number
  message?: string
}

/** Ready timeout: model load is ~2 s warm, up to a couple of minutes cold. */
const READY_TIMEOUT_MS = 120_000

/** Pending request handlers keyed by request id. */
interface PendingRequest {
  resolve: (result: MlxSynthResult) => void
  reject: (error: Error) => void
  outDir: string
}

/**
 * One resident worker plus its request queue. Create lazily, dispose with the
 * plugin fiber.
 */
export class MlxEngine {
  private child: ChildProcessWithoutNullStreams | null = null
  private readyPromise: Promise<void> | null = null
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: Error) => void) | null = null
  private stdoutBuffer = ''
  private stderrTail = ''
  private readonly pending = new Map<string, PendingRequest>()
  private tail: Promise<unknown> = Promise.resolve()
  private disposed = false
  private readyTimer: NodeJS.Timeout | null = null

  constructor(private readonly resolved: ResolvedConfig) {}

  /**
   * Synthesize one utterance through the resident worker.
   *
   * @param text - text to speak (sanitized by the caller).
   * @param voice - per-call voice override, or undefined for the configured one.
   * @param signal - abort signal; firing it cancels this request (worker stays warm).
   * @returns the concatenated WAV plus worker timing facts.
   */
  synthesize(text: string, voice: string | undefined, signal: AbortSignal): Promise<MlxSynthResult> {
    const run = this.tail.then(
      () => this.runRequest(text, voice, signal),
      () => this.runRequest(text, voice, signal),
    )
    this.tail = run.catch(() => undefined)
    return run
  }

  /** Kill the worker (plugin unload / host shutdown). */
  dispose(): void {
    this.disposed = true
    this.failAll(new EngineFailure('mlx: worker disposed', true))
    if (this.child !== null) {
      try {
        this.child.kill('SIGTERM')
      } catch {
        // Already gone.
      }
      this.child = null
    }
    this.readyPromise = null
    this.readyResolve = null
    this.readyReject = null
    if (this.readyTimer !== null) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
  }

  private async runRequest(text: string, voice: string | undefined, signal: AbortSignal): Promise<MlxSynthResult> {
    if (this.disposed) throw new EngineFailure('mlx: worker disposed', true)
    if (signal.aborted) throw new EngineFailure('mlx: interrupted before synthesis', true)
    await this.ensureReady(signal)
    const child = this.child
    if (child === null) throw new EngineFailure('mlx: worker is not running', false)
    const id = randomUUID()
    const outDir = await mkdtemp(join(tmpdir(), 'dsh-talk-mlx-'))
    try {
      return await new Promise<MlxSynthResult>((resolve, reject) => {
        const cleanup = (): void => {
          signal.removeEventListener('abort', onAbort)
          this.pending.delete(id)
        }
        const onAbort = (): void => {
          this.send({ type: 'cancel', id })
          cleanup()
          void rm(outDir, { recursive: true, force: true }).catch(() => {})
          reject(new EngineFailure('mlx: interrupted', true))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        this.pending.set(id, {
          resolve: result => {
            cleanup()
            resolve(result)
          },
          reject: error => {
            cleanup()
            reject(error)
          },
          outDir,
        })
        try {
          this.send({
            id,
            text,
            ...(voice === undefined ? {} : { voice }),
            chunkChars: this.resolved.mlxChunkChars,
            outDir,
          })
        } catch (error) {
          cleanup()
          reject(new EngineFailure(`mlx: failed to send request: ${sanitizeText(error instanceof Error ? error.message : String(error))}`, signal.aborted))
        }
      })
    } catch (error) {
      await rm(outDir, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  private ensureReady(signal: AbortSignal): Promise<void> {
    if (this.child !== null && this.readyPromise !== null) return this.readyPromise
    if (this.readyPromise !== null) return this.readyPromise
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.readyTimer = setTimeout(() => {
      this.failReady(new EngineFailure(`mlx: worker did not become ready within ${READY_TIMEOUT_MS / 1000}s`, false))
    }, READY_TIMEOUT_MS)
    const script = this.resolved.mlxScript ?? defaultMlxScript()
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(
        this.resolved.mlxCommand,
        [
          script,
          '--model', this.resolved.mlxModel,
          '--voice', this.resolved.mlxVoice,
          '--lang', this.resolved.mlxLanguage,
          '--chunk-chars', String(this.resolved.mlxChunkChars),
          '--buffer-seconds', '1.5',
          '--player', this.resolved.mlxPlayer,
          '--temperature', String(this.resolved.mlxTemperature),
          '--top-p', String(this.resolved.mlxTopP),
          '--top-k', String(this.resolved.mlxTopK),
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1' } },
      )
    } catch (error) {
      this.failReady(new EngineFailure(`mlx failed to start: ${sanitizeText(error instanceof Error ? error.message : String(error))}`, false))
      return this.readyPromise
    }
    this.child = child
    this.stdoutBuffer = ''
    this.stderrTail = ''
    child.stdout.on('data', (bytes: Buffer) => this.onStdout(bytes.toString('utf8')))
    child.stderr.on('data', (bytes: Buffer) => {
      this.stderrTail = (this.stderrTail + bytes.toString('utf8')).slice(-8192)
    })
    child.on('error', error => {
      this.failReady(new EngineFailure(`mlx failed to start: ${sanitizeText(error.message)}`, false))
      this.onExit()
    })
    child.on('close', () => this.onExit())
    if (signal.aborted) {
      this.failReady(new EngineFailure('mlx: interrupted', true))
    }
    return this.readyPromise
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      newline = this.stdoutBuffer.indexOf('\n')
      if (line !== '') this.onEventLine(line)
    }
  }

  private onEventLine(line: string): void {
    let event: WorkerEvent
    try {
      event = JSON.parse(line) as WorkerEvent
    } catch {
      return
    }
    if (event.type === 'ready') {
      if (this.readyTimer !== null) {
        clearTimeout(this.readyTimer)
        this.readyTimer = null
      }
      this.readyResolve?.()
      this.readyResolve = null
      this.readyReject = null
      return
    }
    if (event.type === 'error' && event.id === undefined) {
      this.failReady(new EngineFailure(`mlx worker error: ${sanitizeText(event.message ?? 'unknown')}`, false))
      return
    }
    const id = event.id
    if (id === undefined) return
    const pending = this.pending.get(id)
    if (pending === undefined) return
    if (event.type === 'cancelled') {
      void rm(pending.outDir, { recursive: true, force: true }).catch(() => {})
      pending.reject(new EngineFailure('mlx: interrupted', true))
      return
    }
    if (event.type === 'error') {
      void rm(pending.outDir, { recursive: true, force: true }).catch(() => {})
      pending.reject(new EngineFailure(`mlx failed: ${sanitizeText(event.message ?? 'unknown')}`, false))
      return
    }
    if (event.type !== 'done' || event.file === undefined) return
    void (async () => {
      try {
        const data = await readFile(event.file as string)
        if (data.byteLength === 0) throw new EngineFailure('mlx produced no audio', false)
        pending.resolve({
          data,
          mime: 'audio/wav',
          audioSec: typeof event.audioSec === 'number' ? event.audioSec : 0,
          firstAudioSec: typeof event.firstAudioSec === 'number' ? event.firstAudioSec : null,
          synthSec: typeof event.synthSec === 'number' ? event.synthSec : 0,
        })
      } catch (error) {
        pending.reject(error instanceof Error ? error : new EngineFailure(String(error), false))
      } finally {
        void rm(pending.outDir, { recursive: true, force: true }).catch(() => {})
      }
    })()
  }

  private onExit(): void {
    this.child = null
    if (this.readyPromise !== null && this.readyReject !== null) {
      this.failReady(new EngineFailure(`mlx worker exited before ready${this.stderrTail === '' ? '' : `: ${sanitizeText(this.stderrTail)}`}`, false))
    }
    this.failAll(new EngineFailure(`mlx worker exited${this.stderrTail === '' ? '' : `: ${sanitizeText(this.stderrTail)}`}`, false))
    this.readyPromise = null
  }

  private failReady(error: Error): void {
    if (this.readyTimer !== null) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
    const reject = this.readyReject
    this.readyReject = null
    this.readyResolve = null
    this.readyPromise = null
    reject?.(error)
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }

  private send(payload: Record<string, unknown>): void {
    const child = this.child
    if (child === null || child.stdin.destroyed) throw new EngineFailure('mlx: worker is not running', false)
    child.stdin.write(`${JSON.stringify(payload)}\n`)
  }
}
