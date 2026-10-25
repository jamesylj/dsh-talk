/**
 * The talk host service: the `speak` pipeline the tool, the auto-reply
 * controller, the manual play button and the turn-end announcement share, plus
 * the small `talk` Remote namespace the client button and settings panel use.
 *
 * Both engines play on the host (MiniMax streams SSE MP3 into ffplay; MLX runs
 * the resident Qwen3-TTS worker through sounddevice), so there is no browser
 * audio path, no audio cache and no projection: the service only needs to
 * start, track and stop host playback. MiniMax failures fall back to the
 * offline MLX clone engine when `tts.mlx.refAudio` is configured.
 *
 * @module dsh-talk/service
 */

import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Session, SessionStore } from '@deepseek-ai/dsh-session'
import type { Config, ResolvedConfig, TtsEngine } from './config.ts'
import { resolveConfig } from './config.ts'
import type { LocalTtsEngine } from './audio-export.ts'
import { exportSynthesizedAudio } from './audio-export.ts'
import { EngineFailure } from './engine.ts'
import { appendDiagnostic, describeError } from './diagnostics.ts'
import { findLatestAssistantText } from './auto-reply.ts'
import { MlxEngine } from './mlx.ts'
import { MinimaxEngine } from './minimax.ts'
import { sanitizeText } from './sanitize.ts'
import {
  appendSettingsFragment,
  mergeTalkRowConfig,
  renderSettingsFragment,
  validateSettingsInput,
} from './settings-patch.ts'
import { appendSpeechEvent } from './speech.ts'
import type { DshTalkSpeechEvent, SpeechReason, SpeechTtsEngine } from './speech.ts'
import type { TalkMode, TalkModeResult, TalkPlayResult, TalkSettingsInput, TalkSettingsResult, TalkStatus, TalkStopResult } from './wire.ts'
import { TALK_MODES } from './wire.ts'

/** Profile patch-layer filename the settings panel appends to. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** Export directory policy (the plugin always uses its own bounded directory). */
const EXPORT_MAX_FILES = 20

/** Export age cap in minutes (24 hours). */
const EXPORT_MAX_AGE_MINUTES = 1_440

/** One in-flight synthesis/playback, retained so interruption can be scoped. */
interface ActiveSynthesis {
  /** Aborts this utterance's engine work (and its playback). */
  readonly controller: AbortController
  /** Session that owns the utterance; absent for headless calls. */
  readonly sessionId?: string
}

/** Result of one speak request (the speak tool's canonical value). */
export interface SpeakOutcome {
  /** Whether audio was produced. */
  spoken: boolean
  /** Engine that produced (or would have produced) the audio. */
  engine: TtsEngine
  /** Synthesized audio size in bytes; 0 on failure. */
  audioBytes: number
  /** Playback duration in seconds; absent on failure. */
  durationSec?: number
  /** Sanitized failure note; absent on clean success. */
  error?: string
  /** Stable id of this utterance. */
  utteranceId?: string
  /** Absolute path of the exported audio file (when `tts.export.enabled`). */
  audioPath?: string
  /** What happened to the audio file: `file` / `disabled` / `failed`. */
  audioExport?: 'file' | 'disabled' | 'failed'
  /** Sanitized explanation for every export state except `file`. */
  exportNote?: string
}

/** Options for one speak request. */
export interface SpeakOptions {
  /** Engine override (tool arg); falls back to the resolved config. */
  engine?: TtsEngine
  /** Why the utterance is spoken (logged with the event). */
  reason: SpeechReason
  /** Session the utterance is logged to; absent = no log (headless trial). */
  session?: Session
  /** Caller abort signal (the tool's exec signal). */
  signal?: AbortSignal
  /** Interrupt same-session speech before starting (default true). */
  interrupt?: boolean
}

/** One engine synthesis result. */
interface SynthResult {
  /** MIME type of the produced audio. */
  mime: 'audio/mpeg' | 'audio/wav'
  /** The audio bytes. */
  data: Uint8Array
  /** Playback duration in seconds (0 when unknown). */
  audioSec: number
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
  static inject = ['subprocess']

  /** In-flight syntheses by utterance id, scoped by session for interruption. */
  private readonly activeSyntheses = new Map<string, ActiveSynthesis>()
  /** Resident MLX worker (model stays warm across utterances); lazily spawned. */
  private mlxEngine: MlxEngine | null = null
  /** MiniMax cloud engine (SSE → ffplay); lazily created. */
  private minimaxEngine: MinimaxEngine | null = null
  /**
   * Runtime auto/manual override set by the composer mode button. `null` means
   * "no override yet": the configured `autoReply.enabled` decides. The mode is
   * interaction state, not configuration, so it lives with the plugin instance
   * and is not persisted — a restart falls back to the configured default.
   */
  private modeOverride: TalkMode | null = null

  /**
   * @param ctx - context carrying the subprocess service and the session store.
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
        this.mlxEngine?.dispose()
        this.mlxEngine = null
        this.minimaxEngine = null
      })
    }
  }

  /** Lazily start the resident MLX worker. */
  private getMlxEngine(): MlxEngine {
    if (this.mlxEngine === null) this.mlxEngine = new MlxEngine(this.resolved)
    return this.mlxEngine
  }

  /** Lazily create the MiniMax cloud engine (no model to warm up). */
  private getMinimaxEngine(): MinimaxEngine {
    if (this.minimaxEngine === null) this.minimaxEngine = new MinimaxEngine(this.ctx.subprocess, this.resolved)
    return this.minimaxEngine
  }

  /**
   * Synthesize one utterance on the host and log it. The resolved engine is
   * tried first; when it is MiniMax and fails for a non-abort reason, the MLX
   * clone engine takes over if `tts.fallback` and a reference WAV exist.
   *
   * @param text - text to speak (sanitized and capped here).
   * @param options - engine/reason/session/signal/interrupt.
   * @returns the speak outcome (the tool's canonical value).
   */
  async speak(text: string, options: SpeakOptions): Promise<SpeakOutcome> {
    const spoken = sanitizeText(text, this.resolved.maxSpeakChars)
    if (spoken === '') throw new Error('dsh-talk: speak text must not be empty')

    // Preemption is scoped: a new utterance only stops speech the SAME session
    // already had in flight. Auto-read and announcements pass `interrupt: false`,
    // so a long read plays to completion.
    if (options.interrupt !== false) {
      this.interrupt(options.session === undefined ? undefined : { sessionId: String(options.session.id) })
    }

    let engine: TtsEngine = options.engine ?? this.resolved.ttsEngine
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
      let result: SynthResult
      try {
        result = await this.synthesizeWith(engine, spoken, signal)
      } catch (error) {
        // A MiniMax failure is recoverable: the offline MLX clone engine is the
        // documented fallback, but only when it is actually configured.
        const failure = error instanceof EngineFailure
          ? error
          : new EngineFailure(sanitizeText(error instanceof Error ? error.message : String(error)), false)
        if (failure.aborted || engine !== 'minimax' || !this.resolved.ttsFallback || this.resolved.mlxRefAudio === null) {
          throw failure
        }
        engine = 'mlx'
        result = await this.synthesizeWith(engine, spoken, signal)
      }
      const exported = await this.exportAudio(engine, utteranceId, result.data)
      const durationSec = result.audioSec > 0 ? result.audioSec : Math.max(0, (Date.now() - startedAt) / 1000)
      this.recordSpeechEvent(options.session, this.speechEvent(utteranceId, engine, spoken, result.data.byteLength, options.reason))
      return { spoken: true, engine, audioBytes: result.data.byteLength, durationSec, utteranceId, ...exported }
    } catch (error) {
      const failure = error instanceof EngineFailure
        ? error
        : new EngineFailure(sanitizeText(error instanceof Error ? error.message : String(error)), false)
      if (failure.aborted) {
        this.recordSpeechEvent(options.session, this.speechEvent(utteranceId, engine, spoken, 0, options.reason, 'interrupted', true))
        return { spoken: false, engine, audioBytes: 0, error: 'interrupted', utteranceId }
      }
      this.recordSpeechEvent(options.session, this.speechEvent(utteranceId, engine, spoken, 0, options.reason, failure.message))
      return { spoken: false, engine, audioBytes: 0, error: failure.message, utteranceId }
    } finally {
      this.activeSyntheses.delete(utteranceId)
    }
  }

  /** Run one engine's synthesis for one utterance. */
  private async synthesizeWith(engine: TtsEngine, text: string, signal: AbortSignal): Promise<SynthResult> {
    if (engine === 'minimax') {
      const result = await this.getMinimaxEngine().synthesize(text, signal)
      return { mime: 'audio/mpeg', data: result.data, audioSec: result.audioSec }
    }
    const result = await this.getMlxEngine().synthesize(text, signal)
    return { mime: 'audio/wav', data: result.data, audioSec: result.audioSec }
  }

  /** Assemble one speech event payload. */
  private speechEvent(
    utteranceId: string,
    engine: SpeechTtsEngine,
    text: string,
    audioBytes: number,
    reason: SpeechReason,
    error?: string,
    interrupted?: boolean,
  ): DshTalkSpeechEvent {
    return {
      kind: 'tts',
      utteranceId,
      engine,
      text,
      audioBytes,
      reason,
      ...(error !== undefined ? { error } : {}),
      ...(interrupted === true ? { interrupted: true } : {}),
    }
  }

  /**
   * Write one synthesized utterance to the bounded export directory when the
   * user enabled export. Exporting never fails the utterance.
   */
  private async exportAudio(engine: LocalTtsEngine, utteranceId: string, data: Uint8Array): Promise<{
    audioPath?: string
    audioExport: 'file' | 'disabled' | 'failed'
    exportNote?: string
  }> {
    const outcome = await exportSynthesizedAudio(
      {
        enabled: this.resolved.ttsExportEnabled,
        dir: this.resolved.ttsExportDir,
        maxFiles: EXPORT_MAX_FILES,
        maxAgeMinutes: EXPORT_MAX_AGE_MINUTES,
      },
      engine,
      utteranceId,
      data,
    )
    if (outcome.audioExport === 'failed') {
      this.ctx.logger.warn(`dsh-talk: ${outcome.exportNote ?? 'audio export failed'}`)
    }
    const state = outcome.audioExport === 'unsupported' ? 'failed' : outcome.audioExport
    return {
      ...(outcome.audioPath === undefined ? {} : { audioPath: outcome.audioPath }),
      audioExport: state,
      ...(outcome.exportNote === undefined ? {} : { exportNote: outcome.exportNote }),
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
      engine: this.resolved.ttsEngine,
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
      engine: outcome.engine,
      ...(outcome.spoken ? { text } : {}),
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
   * every in-flight host synthesis and playback.
   *
   * @returns whether anything was stopped.
   */
  stop(): TalkStopResult {
    return this.interrupt()
  }

  /**
   * Stop in-flight host synthesis, optionally scoped to one session. `stop()`
   * is the Remote verb; this scoped form is what the speak pipeline preempts
   * with, so a new utterance only interrupts the SAME session.
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
    return { stopped }
  }

  /** Whether a host synthesis/playback is in flight right now. */
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
      note: 'Settings appended to the profile patch layer. Reload the profile (or restart the web app) to apply them.',
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
