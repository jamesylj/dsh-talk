/**
 * The talk host service for the `android` branch: MiniMax synthesis only.
 *
 * The Android runtime has no host-side audio player, so the service synthesizes
 * one utterance at a time, queues the MP3 for the Web UI to drain through
 * `talk/pending`, and lets the WebView play it. The `speak` tool, the
 * automatic reply read-aloud, the manual play button and the turn-end
 * announcement all share this pipeline; the composer mode button switches the
 * auto/manual interaction mode at runtime.
 *
 * @module dsh-talk/service
 */

import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Session, SessionStore } from '@deepseek-ai/dsh-session'
import type { Config, ResolvedConfig } from './config.ts'
import { resolveConfig } from './config.ts'
import { appendDiagnostic, describeError } from './diagnostics.ts'
import { EngineFailure } from './engine.ts'
import { findLatestAssistantText } from './auto-reply.ts'
import { MinimaxEngine } from './minimax.ts'
import { sanitizeText } from './sanitize.ts'
import {
  appendSettingsFragment,
  mergeTalkRowConfig,
  renderSettingsFragment,
  validateSettingsInput,
} from './settings-patch.ts'
import { appendSpeechEvent } from './speech.ts'
import type { DshTalkSpeechEvent, SpeechReason } from './speech.ts'
import type {
  TalkMode,
  TalkModeResult,
  TalkPendingResult,
  TalkPlayResult,
  TalkSettingsInput,
  TalkSettingsResult,
  TalkStatus,
  TalkStopResult,
  TalkUtterance,
} from './wire.ts'
import { TALK_MODES } from './wire.ts'

/** Profile patch-layer filename the settings panel appends to. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** Utterances retained for the client at most (oldest dropped first). */
const QUEUE_MAX_ITEMS = 6

/** Total queued audio retained at most (base64 transport, keep it bounded). */
const QUEUE_MAX_BYTES = 24 * 1024 * 1024

/** One in-flight synthesis, retained so interruption can be scoped. */
interface ActiveSynthesis {
  /** Aborts this utterance's engine work. */
  readonly controller: AbortController
  /** Session that owns the utterance; absent for headless calls. */
  readonly sessionId?: string
}

/** One queued utterance waiting for the Web UI to play it. */
interface QueuedUtterance {
  readonly id: string
  readonly seq: number
  readonly sessionId: string
  readonly text: string
  readonly mime: string
  readonly data: Uint8Array
}

/** Result of one speak request (the speak tool's canonical value). */
export interface SpeakOutcome {
  /** Whether audio was synthesized and queued. */
  spoken: boolean
  /** Engine that produced (or would have produced) the audio. */
  engine: 'minimax'
  /** Synthesized audio size in bytes; 0 on failure. */
  audioBytes: number
  /** Audio duration in seconds; absent on failure. */
  durationSec?: number
  /** Sanitized failure note; absent on clean success. */
  error?: string
  /** Stable id of this utterance. */
  utteranceId?: string
}

/** Options for one speak request. */
export interface SpeakOptions {
  /** Why the utterance is spoken (logged with the event). */
  reason: SpeechReason
  /** Session the utterance is logged to; absent = no log (headless trial). */
  session?: Session
  /** Caller abort signal (the tool's exec signal). */
  signal?: AbortSignal
  /** Interrupt same-session speech before starting (default true). */
  interrupt?: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Voice-loop host service (this package). */
    talk: TalkService
  }
}

/**
 * Voice-loop host service exported over the `talk` Remote namespace.
 */
export class TalkService extends TypertRemoteService {
  /** In-flight syntheses by utterance id, scoped by session for interruption. */
  private readonly activeSyntheses = new Map<string, ActiveSynthesis>()
  /** Queued utterances the client has not played yet, oldest first. */
  private readonly queue: QueuedUtterance[] = []
  /** Monotonic queue cursor. */
  private cursor = 0
  /** MiniMax cloud engine (SSE → collected MP3); lazily created. */
  private minimaxEngine: MinimaxEngine | null = null
  /**
   * Runtime auto/manual override set by the composer mode button. `null` means
   * "no override yet": the configured `autoReply.enabled` decides. The mode is
   * interaction state, not configuration, so a restart falls back to the
   * configured default.
   */
  private modeOverride: TalkMode | null = null

  /**
   * @param ctx - context (session store lookup happens structurally).
   * @param rawConfig - the row's raw loader config (settings writes merge over it).
   * @param resolved - the resolved runtime policy.
   * @param backupCount - patch backups retained per settings write.
   */
  constructor(
    ctx: Context,
    private readonly rawConfig: Config | undefined,
    private readonly resolved: ResolvedConfig,
    private readonly backupCount: number,
  ) {
    super(ctx, 'talk')
    const effect = (ctx as unknown as { effect?: (register: () => () => void) => unknown }).effect
    if (typeof effect === 'function') {
      effect(() => () => {
        this.minimaxEngine = null
        this.queue.length = 0
      })
    }
  }

  /** Lazily create the MiniMax cloud engine (no local model to warm up). */
  private getMinimaxEngine(): MinimaxEngine {
    if (this.minimaxEngine === null) this.minimaxEngine = new MinimaxEngine(this.resolved)
    return this.minimaxEngine
  }

  /**
   * Synthesize one utterance and queue it for the Web UI to play.
   *
   * @param text - text to speak (sanitized and capped here).
   * @param options - reason/session/signal/interrupt.
   * @returns the speak outcome (the tool's canonical value).
   */
  async speak(text: string, options: SpeakOptions): Promise<SpeakOutcome> {
    const spoken = sanitizeText(text, this.resolved.maxSpeakChars)
    if (spoken === '') throw new Error('dsh-talk: speak text must not be empty')

    // Preemption is scoped: a new utterance only stops speech the SAME session
    // already had in flight or queued. Auto-read and announcements pass
    // `interrupt: false`, so a long read plays to completion.
    if (options.interrupt !== false) {
      this.interrupt(options.session === undefined ? undefined : { sessionId: String(options.session.id) })
    }

    const utteranceId = randomUUID()
    const controller = new AbortController()
    this.activeSyntheses.set(utteranceId, {
      controller,
      ...(options.session === undefined ? {} : { sessionId: String(options.session.id) }),
    })
    const signal = options.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, options.signal])
    const startedAt = Date.now()
    try {
      if (signal.aborted) throw new EngineFailure('speech was interrupted before synthesis', true)
      const result = await this.getMinimaxEngine().synthesize(spoken, signal)
      const durationSec = result.audioSec > 0 ? result.audioSec : Math.max(0, (Date.now() - startedAt) / 1000)
      this.enqueue({
        id: utteranceId,
        sessionId: options.session === undefined ? '' : String(options.session.id),
        text: spoken,
        mime: result.mime,
        data: result.data,
      })
      this.recordSpeechEvent(options.session, this.speechEvent(utteranceId, spoken, result.data.byteLength, options.reason))
      return { spoken: true, engine: 'minimax', audioBytes: result.data.byteLength, durationSec, utteranceId }
    } catch (error) {
      const failure = error instanceof EngineFailure
        ? error
        : new EngineFailure(sanitizeText(error instanceof Error ? error.message : String(error)), false)
      if (failure.aborted) {
        this.recordSpeechEvent(options.session, this.speechEvent(utteranceId, spoken, 0, options.reason, 'interrupted', true))
        return { spoken: false, engine: 'minimax', audioBytes: 0, error: 'interrupted', utteranceId }
      }
      void appendDiagnostic('speak', `${failure.message} (reason ${options.reason})`)
      this.recordSpeechEvent(options.session, this.speechEvent(utteranceId, spoken, 0, options.reason, failure.message))
      return { spoken: false, engine: 'minimax', audioBytes: 0, error: failure.message, utteranceId }
    } finally {
      this.activeSyntheses.delete(utteranceId)
    }
  }

  /** Append one utterance to the client queue, pruning the oldest entries. */
  private enqueue(entry: Omit<QueuedUtterance, 'seq'>): void {
    this.cursor += 1
    this.queue.push({ ...entry, seq: this.cursor })
    let bytes = this.queue.reduce((total, item) => total + item.data.byteLength, 0)
    while (this.queue.length > 1 && (this.queue.length > QUEUE_MAX_ITEMS || bytes > QUEUE_MAX_BYTES)) {
      const dropped = this.queue.shift()
      if (dropped === undefined) break
      bytes -= dropped.data.byteLength
    }
  }

  /** Assemble one speech event payload. */
  private speechEvent(
    utteranceId: string,
    text: string,
    audioBytes: number,
    reason: SpeechReason,
    error?: string,
    interrupted?: boolean,
  ): DshTalkSpeechEvent {
    return {
      kind: 'tts',
      utteranceId,
      engine: 'minimax',
      text,
      audioBytes,
      reason,
      ...(error !== undefined ? { error } : {}),
      ...(interrupted === true ? { interrupted: true } : {}),
    }
  }

  /** Append one log-only speech event; a disposed session must never kill speech. */
  private recordSpeechEvent(session: Session | undefined, event: DshTalkSpeechEvent): void {
    if (session === undefined) return
    try {
      appendSpeechEvent(session, event)
    } catch (error) {
      this.ctx.logger.warn(`dsh-talk: failed to log speech event: ${sanitizeText(error instanceof Error ? error.message : String(error))}`)
    }
  }

  /** Read-only state snapshot for the button and settings tab. */
  status(): TalkStatus {
    return {
      speaking: this.activeSyntheses.size > 0,
      voiceId: this.resolved.minimaxVoiceId,
      mode: this.mode(),
    }
  }

  /**
   * The effective interaction mode: the composer button's runtime override when
   * it exists, otherwise the configured `autoReply.enabled` default.
   *
   * @returns `auto` (read every reply aloud) or `manual` (button only).
   */
  mode(): TalkMode {
    return this.modeOverride ?? (this.resolved.autoReplyEnabled ? 'auto' : 'manual')
  }

  /**
   * Switch the interaction mode at runtime (the composer mode button). Takes
   * effect immediately for the auto-reply controller and the turn-end
   * announcement; the configured default is untouched.
   *
   * @param mode - the mode to switch to.
   * @returns the effective mode after the switch.
   */
  applyMode(mode: TalkMode): TalkModeResult {
    if (!(TALK_MODES as readonly string[]).includes(mode)) {
      throw new Error(`dsh-talk: mode must be one of ${TALK_MODES.join(' | ')}`)
    }
    this.modeOverride = mode
    return { mode: this.mode() }
  }

  /**
   * The utterance queue tail for the Web UI. `since` is the cursor the client
   * saw last; a negative cursor (or one ahead of the host after a reload) is a
   * baseline request that returns no audio.
   *
   * @param since - last-seen queue cursor.
   * @returns the current cursor and the utterances after it.
   */
  pending(since: number): TalkPendingResult {
    const baseline = typeof since !== 'number' || !Number.isFinite(since) || since < 0 || since > this.cursor
    if (baseline) return { cursor: this.cursor, items: [] }
    const items: TalkUtterance[] = []
    for (const entry of this.queue) {
      if (entry.seq <= since) continue
      items.push({
        id: entry.id,
        seq: entry.seq,
        sessionId: entry.sessionId,
        text: entry.text,
        mime: entry.mime,
        audioBase64: Buffer.from(entry.data).toString('base64'),
        bytes: entry.data.byteLength,
      })
    }
    return { cursor: this.cursor, items }
  }

  /**
   * The manual play button: read the newest assistant reply of one session
   * through the same host pipeline. No reply exists → a reported no-op, never
   * an error the client has to translate.
   *
   * @param sessionId - the session whose latest reply should be read.
   * @returns whether something was spoken, plus the engine/text.
   */
  async playLatest(sessionId: string): Promise<TalkPlayResult> {
    if (typeof sessionId !== 'string') {
      throw new Error('dsh-talk: talk/playLatest requires a sessionId string')
    }
    const sessions = this.sessionStore()
    if (sessions === undefined) {
      void appendDiagnostic('playLatest', 'the sessions service is not visible from the talk service context')
      return { spoken: false, engine: null, error: 'session store unavailable' }
    }
    const session = sessionId === '' ? this.newestLiveSession(sessions) : sessions.get(sessionId as never)
    if (session === undefined) {
      void appendDiagnostic('playLatest', sessionId === '' ? 'no live session' : `unknown session ${sessionId}`)
      return { spoken: false, engine: null, error: sessionId === '' ? 'no live session to read' : 'session not found' }
    }
    const text = findLatestAssistantText(session.snapshotEvents(), this.resolved.maxSpeakChars)
    if (text === null) {
      void appendDiagnostic('playLatest', `session ${String(session.id)} has no assistant reply with text`)
      return { spoken: false, engine: null, error: 'no assistant reply to read' }
    }
    const outcome = await this.speak(text, { reason: 'manual', session, interrupt: true })
    if (!outcome.spoken) void appendDiagnostic('playLatest', `engine reported: ${outcome.error ?? 'unknown failure'}`)
    return {
      spoken: outcome.spoken,
      engine: 'minimax',
      ...(outcome.spoken ? { text } : {}),
      ...(outcome.utteranceId === undefined ? {} : { utteranceId: outcome.utteranceId }),
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    }
  }

  /**
   * Resolve the host session store through the documented `ctx.get` service
   * lookup (falling back to the context property), so an unavailable store is
   * reported instead of surfacing as an opaque `session not found`.
   */
  private sessionStore(): SessionStore | undefined {
    try {
      const get = (this.ctx as unknown as { get?: (name: string) => unknown }).get
      const lifted = typeof get === 'function' ? get.call(this.ctx, 'sessions') : undefined
      const candidate = lifted ?? (this.ctx as unknown as { sessions?: SessionStore }).sessions
      if (candidate === undefined || candidate === null) return undefined
      return typeof (candidate as { get?: unknown }).get === 'function' ? candidate as SessionStore : undefined
    } catch (error) {
      void appendDiagnostic('sessionStore', describeError(error))
      return undefined
    }
  }

  /** The live session with the newest log offset (fallback when the client sends no id). */
  private newestLiveSession(store: SessionStore): Session | undefined {
    let newest: Session | undefined
    try {
      for (const session of store.list()) {
        if (newest === undefined || session.seq > newest.seq) newest = session
      }
    } catch (error) {
      void appendDiagnostic('newestLiveSession', describeError(error))
    }
    return newest
  }

  /**
   * The play/stop button's stop verb (the `talk/stop` Remote method): abort
   * every in-flight synthesis and drop the queued utterances.
   *
   * @returns whether anything was stopped.
   */
  stop(): TalkStopResult {
    return this.interrupt()
  }

  /**
   * Stop in-flight synthesis and drop queued utterances, optionally scoped to
   * one session. `stop()` is the Remote verb; this scoped form is what the speak
   * pipeline preempts with, so a new utterance only interrupts the SAME session.
   *
   * @param scope - optional session restriction (unscoped stops everything).
   * @returns whether anything was stopped.
   */
  interrupt(scope?: { readonly sessionId?: string }): TalkStopResult {
    const sessionId = scope?.sessionId
    let stopped = false
    for (const [utteranceId, active] of [...this.activeSyntheses]) {
      if (sessionId !== undefined && active.sessionId !== sessionId) continue
      stopped = true
      active.controller.abort()
      this.activeSyntheses.delete(utteranceId)
    }
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const entry = this.queue[index]
      if (entry === undefined) continue
      if (sessionId !== undefined && entry.sessionId !== sessionId) continue
      this.queue.splice(index, 1)
      stopped = true
    }
    return { stopped }
  }

  /** Whether a host synthesis is in flight right now. */
  isSpeaking(): boolean {
    return this.activeSyntheses.size > 0
  }

  /**
   * Apply the settings panel's edits: validate, merge over the row's raw
   * config, and append one row operation to the profile patch layer.
   *
   * @param settings - the wire-validated panel submission.
   * @returns where the operation landed.
   */
  async applySettings(settings: TalkSettingsInput): Promise<TalkSettingsResult> {
    const validated = validateSettingsInput(settings)
    if (!validated.ok) {
      throw new Error(`dsh-talk: ${validated.issues.map(issue => issue.text).join(' ')}`)
    }
    const file = this.patchFile()
    if (file === null) throw new Error('dsh-talk: cannot locate the profile patch layer (ctx.baseUrl is unset)')
    const rowConfig = mergeTalkRowConfig(this.rawConfig, validated.settings)
    try {
      resolveConfig(rowConfig as Config)
    } catch (error) {
      throw new Error(
        `dsh-talk: refusing to write a configuration that cannot load: ${sanitizeText(error instanceof Error ? error.message : String(error))}`,
      )
    }
    const fragment = renderSettingsFragment(rowConfig)
    const { bytes } = await appendSettingsFragment(file, fragment, this.backupCount)
    return {
      file,
      bytes,
      note: 'Settings appended to the profile patch layer. Reload the profile (or restart the app) to apply them.',
    }
  }

  /** Absolute path of the profile patch layer, or null when unknown. */
  private patchFile(): string | null {
    const ctx = this.ctx as unknown as { baseUrl?: unknown }
    const base = ctx.baseUrl
    if (typeof base !== 'string' || base === '') return null
    const dir = base.startsWith('file://') ? fileURLToPath(base) : base
    return join(dir, PROFILE_PATCH_FILENAME)
  }
}

export default TalkService
