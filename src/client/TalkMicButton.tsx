/**
 * The composer microphone button: record with MediaRecorder, transcribe with
 * the browser's Web Speech API when available (interim results included) or
 * through the host's `talk/transcribe` for the local engines, fill the draft
 * (or send directly when auto-submit is on), and play fresh utterances from
 * the `talk:speech` projection (browser voice locally, cached audio through
 * `talk/audio` for the local engines). Pressing record also interrupts host
 * playback (speak-to-interrupt).
 *
 * @module dsh-talk/client/TalkMicButton
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../projection.ts'
import { claimUtteranceStart, foldMic, initMic, playbackStalled, type MicViewModel } from './present.ts'
import { advanceSilence, isSpeechFrame, rmsOf, silenceTrips } from './vad.ts'
import { selectBrowserVoice } from './browserVoice.ts'
import type { TalkAudio, TalkInterruptResult, TalkStatus, TalkTranscript } from '../wire.ts'

/** Registration-side injected face: the recorder's host/browser bindings. */
export interface TalkMicInjected {
  /** Read the effective settings snapshot once. */
  status: () => Promise<TalkStatus>
  /** Stop in-flight host synthesis. */
  interrupt: () => Promise<TalkInterruptResult>
  /** Host transcription for the local STT engines. */
  transcribe: (audioData: string) => Promise<TalkTranscript>
  /** Serve one cached utterance's audio. */
  audio: (utteranceId: string) => Promise<TalkAudio | null>
  /** Write the transcription into the composer draft. */
  setDraft: (text: string) => void
  /** Send the transcription as a user message. */
  send: (text: string) => Promise<void>
  /**
   * Resolve the current master input facade for one session id through
   * `sessions.scope(id)` + `conversation.input.for(actx)`; undefined when
   * either service is unavailable (rc.8 builds without the scope exchange).
   */
  forSession?: (id: unknown) => { setDraft(text: string): void; submit(): void } | undefined
}

/** Full component props assembled by the input-slot renderer. */
export type TalkMicProps = PropsRuntime<'conversation.input.left'> & InjectFace<TalkMicInjected>
  // The projection seat is structural: the alpha.3 session kit carries
  // `useProjection` on the input-zone standard kit again, but the button still
  // reads it optionally and casts at the single call site.
  & { readonly useProjection?: unknown }

/** Structural face of the standard-kit input actions current master feeds every session-scope slot component. */
interface RuntimeInputActions {
  setDraft(text: string): void
  submit(): void
}

/** Minimal structural face of the Web Speech API (Chrome/Edge). */
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function webRecognition(): SpeechRecognitionLike | undefined {
  const scope = globalThis as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Ctor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition
  if (Ctor === undefined) return undefined
  try {
    return new Ctor()
  } catch {
    return undefined
  }
}

function supportedMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = ['audio/wav', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate
    } catch {
      // isTypeSupported can throw on hostile environments; try the next.
    }
  }
  return undefined
}

/** One utterance's local audio element plus the object URL backing it. */
interface ActivePlayer {
  readonly player: HTMLAudioElement
  readonly url: string
  /** Utterance this element plays (breadcrumbs only). */
  readonly utteranceId: string
}

/**
 * Pause and release one local player: the object URL is revoked even when the
 * element already ended or failed, so the single-active-player rule cannot
 * leak blobs. Idempotent, and safe when the browser has already detached the
 * element.
 *
 * @param active - the player to release, or null.
 */
function releasePlayer(active: ActivePlayer | null): void {
  if (active === null) return
  try {
    active.player.pause()
  } catch {
    // The element is already detached; the URL still has to be revoked.
  }
  try {
    URL.revokeObjectURL(active.url)
  } catch {
    // The URL is already revoked.
  }
}

/**
 * The one active player for this CLIENT RUNTIME, not for one component
 * instance. Playback outlives slot remounts (session-scope rebinds, HMR client
 * reloads): the component's refs die with a remount, but the utterance must not
 * restart — and a re-run of the effect from the same projection frame must not
 * stack a second player.
 *
 * The epoch drops a late `talk/audio` response that a newer utterance
 * superseded; the claim guard (present.ts) drops a re-delivered frame.
 */
let activePlayer: ActivePlayer | null = null

/** Monotonic playback epoch; a newer utterance invalidates older fetches. */
let playbackEpoch = 0

/** Local Storage key for the bounded playback breadcrumbs (diagnostics only). */
const PLAYBACK_DEBUG_KEY = 'dsh-talk:playback-debug'

/**
 * A projection frame older than this is history, not a live utterance. Session
 * switches and remounts re-deliver the last frame of every conversation; playing
 * those re-reads old replies and interrupts whatever is currently speaking.
 */
const MAX_FRAME_AGE_MS = 20_000

/**
 * Append one breadcrumb to a bounded Local Storage ring. This is the client
 * trace readable from disk when a user reports playback anomalies; it never
 * contains utterance text, only kinds/ids/timestamps.
 *
 * @param entry - one play/skip/mount/unmount record.
 */
/** Bounded diagnostic text for one thrown value (breadcrumbs only). */
function briefError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.slice(0, 160)
}

function recordPlaybackBreadcrumb(entry: Record<string, unknown>): void {
  try {
    const storage = globalThis.localStorage
    if (storage === undefined) return
    const list = JSON.parse(storage.getItem(PLAYBACK_DEBUG_KEY) ?? '[]') as unknown[]
    list.push({ at: Date.now(), ...entry })
    storage.setItem(PLAYBACK_DEBUG_KEY, JSON.stringify(list.slice(-120)))
  } catch {
    // Diagnostics must never break playback (private mode, quota, disabled storage).
  }
}

/**
 * Stop whatever this client runtime is playing right now (speak-to-interrupt).
 * The host `interrupt` only aborts synthesis, so the local `<audio>` element
 * must be released here too: without it a player could keep "playing" silently
 * (Bluetooth route switch) or speak over the recording. The epoch bump drops a
 * late `talk/audio` response that belongs to the interrupted utterance.
 *
 * @param reason - diagnostics-only breadcrumb reason.
 */
function stopActivePlayback(reason: string): void {
  playbackEpoch += 1
  if (activePlayer !== null) {
    const active = activePlayer
    activePlayer = null
    recordPlaybackBreadcrumb({
      kind: 'stop-playback',
      reason,
      id: active.utteranceId,
      currentTime: Number(active.player.currentTime.toFixed(2)),
    })
    releasePlayer(active)
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

/**
 * The record button itself. All browser capability reads are feature-detected
 * and degrade to a disabled button with no throw.
 *
 * @param props - injected bindings plus the framework standard kit.
 * @returns the button element.
 */
export function TalkMicButton(props: TalkMicProps): ReactNode {
  const { status, interrupt, transcribe, audio, setDraft, send, useProjection, forSession } = props
  const inputActions = (props as Partial<Record<'inputActions', RuntimeInputActions>>).inputActions
  const sessionIdProp = (props as Partial<Record<'sessionId', unknown>>).sessionId
  const writeDraft = (text: string): void => {
    if (inputActions !== undefined) {
      inputActions.setDraft(text)
      return
    }
    const facade = sessionIdProp !== undefined ? forSession?.(sessionIdProp) : undefined
    if (facade !== undefined) {
      facade.setDraft(text)
      return
    }
    console.warn('[dsh-talk] falling back to rc.8 injected setDraft')
    setDraft(text)
  }
  const submitText = async (text: string): Promise<void> => {
    if (inputActions !== undefined) {
      inputActions.setDraft(text)
      inputActions.submit()
      return
    }
    const facade = sessionIdProp !== undefined ? forSession?.(sessionIdProp) : undefined
    if (facade !== undefined) {
      facade.setDraft(text)
      facade.submit()
      return
    }
    await send(text)
  }
  const [mic, setMic] = useState<MicViewModel>(initMic)
  const [recording, setRecording] = useState(false)
  const [settings, setSettings] = useState<TalkStatus | undefined>(undefined)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedRef = useRef<number>(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceMsRef = useRef<number>(0)
  const micRef = useRef(mic)
  micRef.current = mic
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // One-shot settings snapshot (cap, engines, auto-submit, hotkey).
  useEffect(() => {
    let cancelled = false
    void status().then(snapshot => {
      if (!cancelled) setSettings(snapshot)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [status])

  const finishWithText = (text: string): void => {
    const trimmed = text.trim()
    setMic(foldMic(micRef.current, trimmed === '' ? { kind: 'failed', message: 'empty transcription' } : { kind: 'transcribed', text: trimmed }))
    if (trimmed === '') return
    if (settingsRef.current?.record.autoSubmit === true) {
      void submitText(trimmed)
    } else {
      writeDraft(trimmed)
    }
  }

  const stopRecognition = (): void => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
  }

  const stopRecorder = (): void => {
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder !== null && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // The recorder already stopped; the dataavailable handler finished us.
      }
    }
  }

  // Feature-detected voice-activity detection: attach an AnalyserNode to the
  // live stream when the recorder path is used. Absent AudioContext degrades
  // to no auto-end (the user stops manually).
  const setupVad = (stream: MediaStream, vad: TalkStatus['record']['vad']): void => {
    if (!vad.enabled) return
    const Ctor = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext
    if (Ctor === undefined) return
    try {
      const context = new Ctor()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      audioContextRef.current = context
      analyserRef.current = analyser
      silenceMsRef.current = 0
    } catch {
      // VAD degrades to no auto-end.
    }
  }

  const teardownVad = (): void => {
    analyserRef.current = null
    silenceMsRef.current = 0
    const context = audioContextRef.current
    audioContextRef.current = null
    if (context !== null) {
      try {
        void context.close()
      } catch {
        // The context already closed.
      }
    }
  }

  const stop = (): void => {
    setRecording(false)
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (recognitionRef.current !== null) stopRecognition()
    else stopRecorder()
    teardownVad()
    setMic(foldMic(micRef.current, { kind: 'stopped' }))
  }

  const start = async (): Promise<void> => {
    const snapshot = settingsRef.current
    if (snapshot === undefined || snapshot.record.enabled !== true) return
    // Speak-to-interrupt: starting to talk stops host synthesis AND the local
    // player. The host interrupt only aborts synthesis; without the client-side
    // release the <audio> element keeps its state (and can stall silently).
    if (snapshot.interrupt) {
      stopActivePlayback('record')
      void interrupt()
    }
    // The host resolves `auto` to the configured engine. Only the `web`
    // resolution may use Web Speech; funasr/whisper must go through
    // MediaRecorder -> talk/transcribe, otherwise the local-engine promise is
    // unreachable (issue #25).
    const recognition = snapshot.stt.resolved === 'web' ? webRecognition() : undefined
    if (recognition !== undefined) {
      // An 'auto' language must not assign the empty string: Chrome handles
      // '' badly on some setups (observed as a silent immediate no-speech).
      // Fall back to the browser locale instead.
      const lang = snapshot.stt.language === 'auto'
        ? (navigator.language || 'en-US')
        : snapshot.stt.language
      recognition.lang = lang
      recognition.interimResults = true
      recognition.continuous = true
      recognition.maxAlternatives = 1
      let lastFull = ''
      let recognitionFailed = false
      const silenceFinaliseMs = snapshot.stt.silenceFinaliseMs
      let silenceTimer: ReturnType<typeof setTimeout> | null = null
      const clearSilence = (): void => {
        if (silenceTimer !== null) {
          clearTimeout(silenceTimer)
          silenceTimer = null
        }
      }
      const armSilence = (): void => {
        clearSilence()
        silenceTimer = setTimeout(() => {
          silenceTimer = null
          if (recognitionRef.current !== recognition) return
          try {
            recognition.stop()
          } catch {
            // The recognizer already ended; onend handled finalisation.
          }
        }, silenceFinaliseMs)
      }
      armSilence()
      // Web Speech re-reports the whole results collection on every event, so
      // rebuild the complete transcript from index 0 each time instead of
      // accumulating fragments across events (an accumulator duplicates text
      // whenever a result is revised or re-finalised).
      const buildTranscript = (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }): string => {
        const parts: string[] = []
        for (let index = 0; index < event.results.length; index += 1) {
          const text = event.results[index]?.[0]?.transcript ?? ''
          if (text.trim() !== '') parts.push(text.trim())
        }
        return parts.join(' ')
      }
      recognition.onresult = (event) => {
        lastFull = buildTranscript(event)
        armSilence()
        if (lastFull !== '') writeDraft(lastFull)
      }
      recognition.onend = () => {
        clearSilence()
        recognitionRef.current = null
        setRecording(false)
        if (!recognitionFailed) finishWithText(lastFull)
      }
      recognition.onerror = (event) => {
        clearSilence()
        recognitionFailed = true
        recognitionRef.current = null
        setRecording(false)
        console.warn(`[dsh-talk] speech recognition error: ${String(event.error ?? 'unknown')}`)
        setMic(foldMic(micRef.current, { kind: 'failed', message: `web speech recognition failed (${String(event.error ?? 'unknown')})` }))
      }
      recognitionRef.current = recognition
      try {
        recognition.start()
      } catch {
        recognitionRef.current = null
        setMic(foldMic(micRef.current, { kind: 'failed', message: 'web speech recognition unavailable' }))
        return
      }
      setMic(foldMic(micRef.current, { kind: 'press', maxSeconds: snapshot.record.maxSeconds }))
      setRecording(true)
      return
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setMic(foldMic(micRef.current, { kind: 'failed', message: 'microphone requires a secure origin (https or localhost)' }))
      return
    }
    const mime = supportedMime()
    if (mime === undefined || navigator.mediaDevices === undefined) {
      setMic(foldMic(micRef.current, { kind: 'failed', message: 'MediaRecorder is unavailable in this browser' }))
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setMic(foldMic(micRef.current, { kind: 'failed', message: 'microphone permission denied' }))
      return
    }
    setupVad(stream, snapshot.record.vad)
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime })
    } catch {
      stream.getTracks().forEach(track => track.stop())
      setMic(foldMic(micRef.current, { kind: 'failed', message: 'microphone capture failed' }))
      return
    }
    chunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop())
      const blob = new Blob(chunksRef.current, { type: mime })
      chunksRef.current = []
      void blob.arrayBuffer().then(buffer => {
        let binary = ''
        const bytes = new Uint8Array(buffer)
        for (let index = 0; index < bytes.length; index += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
        }
        return btoa(binary)
      }).then(base64 => transcribe(base64))
        .then(transcript => finishWithText(transcript.text))
        .catch(() => {
          setMic(foldMic(micRef.current, { kind: 'failed', message: 'transcription failed' }))
        })
    }
    recorderRef.current = recorder
    try {
      recorder.start()
    } catch {
      recorderRef.current = null
      setMic(foldMic(micRef.current, { kind: 'failed', message: 'microphone capture failed' }))
      return
    }
    startedRef.current = Date.now()
    setMic(foldMic(micRef.current, { kind: 'press', maxSeconds: snapshot.record.maxSeconds }))
    setRecording(true)
    timerRef.current = setInterval(() => {
      const elapsed = Math.ceil((Date.now() - startedRef.current) / 1000)
      setMic(foldMic(micRef.current, { kind: 'tick', elapsedSec: elapsed, maxSeconds: settingsRef.current?.record.maxSeconds ?? 60 }))
      const analyser = analyserRef.current
      const vad = settingsRef.current?.record.vad
      if (analyser !== null && vad?.enabled === true) {
        const buffer = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(buffer)
        silenceMsRef.current = advanceSilence(silenceMsRef.current, 500, isSpeechFrame(rmsOf(buffer), vad.energyThreshold))
        if (silenceTrips(silenceMsRef.current, vad.silenceMs)) {
          stop()
          return
        }
      }
      if (elapsed >= (settingsRef.current?.record.maxSeconds ?? 60)) stop()
    }, 500)
  }

  // Optional toggle hotkey.
  useEffect(() => {
    const hotkey = settings?.record.hotkey
    if (hotkey === null || hotkey === undefined || hotkey === '') return
    const listener = (event: KeyboardEvent): void => {
      if (event.altKey && event.key.toLowerCase() === hotkey.toLowerCase().slice('alt+'.length)) {
        event.preventDefault()
        if (recording) stop()
        else void start()
      }
    }
    window.addEventListener('keydown', listener)
    return () => {
      window.removeEventListener('keydown', listener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, recording])

  // Playback: fresh utterances from the talk:speech projection. The seat is
  // optional on this host line, so the hook is only called when the kit
  // actually provides it — calling an undefined `useProjection` threw and took
  // the whole button down; now a missing seat simply means no playback while
  // the mic itself keeps working. The prop is stable for the component's
  // lifetime (the slot kit either supplies the seat for the whole mount or
  // never does), so the conditional call cannot reorder hooks.
  const readProjection = typeof useProjection === 'function'
    ? useProjection as unknown as (unit: 'talk:speech') => {
      utteranceId: string
      engine?: string
      text?: string
      voice?: string
      rate?: number
      pitch?: number
      at?: number
    } | null | undefined
    : undefined
  const speech = readProjection === undefined ? undefined : readProjection('talk:speech')
  // Playback is strictly serial and survives this component: each new utterance
  // first stops whatever the previous one started — the local <audio> is paused
  // and its object URL revoked, and any browser speech is cancelled — so two
  // quick auto-reply turns can never overlap. The SAME projected utterance is
  // claimed once per client runtime, so a remount or a re-delivered projection
  // baseline cannot replay an old reply (the reported repeat loop).
  useEffect(() => {
    if (speech === null || speech === undefined) return
    if (!claimUtteranceStart(speech.utteranceId)) {
      recordPlaybackBreadcrumb({ kind: 'skip-duplicate', id: speech.utteranceId })
      return
    }
    // Claim first (so this frame can never replay), then drop history: a
    // session switch or remount re-delivers the previous conversation's last
    // frame, and speaking it would cut the live reply short.
    if (typeof speech.at === 'number' && Date.now() - speech.at > MAX_FRAME_AGE_MS) {
      recordPlaybackBreadcrumb({ kind: 'skip-stale', id: speech.utteranceId, ageMs: Date.now() - speech.at })
      return
    }
    recordPlaybackBreadcrumb({ kind: 'play', id: speech.utteranceId, engine: speech.engine ?? 'unknown' })
    const epoch = (playbackEpoch += 1)
    if (activePlayer !== null) {
      recordPlaybackBreadcrumb({
        kind: 'stop-previous',
        id: activePlayer.utteranceId,
        currentTime: Number(activePlayer.player.currentTime.toFixed(2)),
        duration: Number.isFinite(activePlayer.player.duration) ? Number(activePlayer.player.duration.toFixed(2)) : null,
      })
    }
    releasePlayer(activePlayer)
    activePlayer = null
    // A queued/previous SpeechSynthesis utterance must not overlap this one,
    // whichever engine produced it.
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    // Shared browser-voice delivery: used directly for browser records and as
    // the guaranteed fallback when the host audio bytes cannot be fetched or
    // played (cache evicted, transport error, autoplay rejection). Silence is
    // never the right degradation for an utterance that should be heard.
    const speakWithBrowser = (): void => {
      if (typeof speechSynthesis === 'undefined') {
        recordPlaybackBreadcrumb({ kind: 'speech-unavailable', id: speech.utteranceId })
        console.warn('[dsh-talk] speechSynthesis unavailable')
        return
      }
      const utterance = new SpeechSynthesisUtterance(speech.text)
      const voice = selectBrowserVoice(speechSynthesis.getVoices(), speech.voice)
      if (voice !== undefined) utterance.voice = voice
      if (speech.rate !== undefined) utterance.rate = speech.rate
      if (speech.pitch !== undefined) utterance.pitch = speech.pitch
      utterance.addEventListener('start', () => {
        recordPlaybackBreadcrumb({ kind: 'speech-start', id: speech.utteranceId })
      })
      utterance.addEventListener('error', event => {
        recordPlaybackBreadcrumb({ kind: 'speech-error', id: speech.utteranceId, error: String((event as { error?: unknown }).error ?? 'unknown') })
      })
      utterance.addEventListener('end', () => {
        recordPlaybackBreadcrumb({ kind: 'speech-end', id: speech.utteranceId })
      })
      speechSynthesis.speak(utterance)
    }
    if (speech.engine === 'browser') {
      speakWithBrowser()
      return
    }
    recordPlaybackBreadcrumb({ kind: 'audio-start', id: speech.utteranceId })
    void audio(speech.utteranceId).then(entry => {
      if (epoch !== playbackEpoch) {
        recordPlaybackBreadcrumb({ kind: 'audio-stale', id: speech.utteranceId })
        return
      }
      if (entry === null) {
        recordPlaybackBreadcrumb({ kind: 'audio-null', id: speech.utteranceId })
        speakWithBrowser()
        return
      }
      let url: string | null = null
      try {
        const binary = atob(entry.data)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        url = URL.createObjectURL(new Blob([bytes], { type: entry.mime }))
        const player = new Audio(url)
        const active: ActivePlayer = { player, url, utteranceId: speech.utteranceId }
        let watchdog: ReturnType<typeof setTimeout> | null = null
        let stallTimer: ReturnType<typeof setInterval> | null = null
        let lastProgressAt = Date.now()
        const clearStartWatchdog = (): void => {
          if (watchdog !== null) {
            clearTimeout(watchdog)
            watchdog = null
          }
        }
        const releaseActive = (): void => {
          clearStartWatchdog()
          if (stallTimer !== null) {
            clearInterval(stallTimer)
            stallTimer = null
          }
          if (activePlayer === active) activePlayer = null
          releasePlayer(active)
        }
        // A started flag + watchdog covers the third silent failure mode: the
        // element neither plays nor rejects (autoplay pending). After 2.5 s of
        // no `playing` event the browser voice takes over.
        let started = false
        let fellBack = false
        const fallbackOnce = (): void => {
          if (started || fellBack) return
          fellBack = true
          releaseActive()
          speakWithBrowser()
        }
        watchdog = setTimeout(() => {
          if (started) return
          recordPlaybackBreadcrumb({ kind: 'play-timeout', id: speech.utteranceId })
          fallbackOnce()
        }, 2500)
        player.addEventListener('ended', () => {
          clearStartWatchdog()
          recordPlaybackBreadcrumb({
            kind: 'media-ended',
            id: speech.utteranceId,
            currentTime: Number(player.currentTime.toFixed(2)),
            duration: Number.isFinite(player.duration) ? Number(player.duration.toFixed(2)) : null,
          })
          releaseActive()
        })
        player.addEventListener('pause', () => {
          recordPlaybackBreadcrumb({
            kind: 'media-pause',
            id: speech.utteranceId,
            currentTime: Number(player.currentTime.toFixed(2)),
            ended: player.ended,
            duration: Number.isFinite(player.duration) ? Number(player.duration.toFixed(2)) : null,
          })
        })
        player.addEventListener('error', () => {
          clearStartWatchdog()
          recordPlaybackBreadcrumb({ kind: 'media-error', id: speech.utteranceId, code: player.error?.code ?? null })
          releaseActive()
          fallbackOnce()
        })
        player.addEventListener('playing', () => {
          started = true
          lastProgressAt = Date.now()
          clearStartWatchdog()
          recordPlaybackBreadcrumb({ kind: 'media-playing', id: speech.utteranceId, bytes: entry.data.length })
        })
        player.addEventListener('timeupdate', () => {
          lastProgressAt = Date.now()
        })
        stallTimer = setInterval(() => {
          if (!playbackStalled(Date.now(), lastProgressAt, player.ended)) return
          recordPlaybackBreadcrumb({
            kind: 'media-stalled',
            id: speech.utteranceId,
            currentTime: Number(player.currentTime.toFixed(2)),
            duration: Number.isFinite(player.duration) ? Number(player.duration.toFixed(2)) : null,
          })
          releaseActive()
        }, 1_000)
        if (epoch === playbackEpoch) activePlayer = active
        void player.play().then(() => {
          recordPlaybackBreadcrumb({ kind: 'play-resolved', id: speech.utteranceId })
        }).catch(error => {
          clearStartWatchdog()
          recordPlaybackBreadcrumb({ kind: 'play-rejected', id: speech.utteranceId, message: briefError(error) })
          fallbackOnce()
        })
      } catch (error) {
        // A failed decode must not leak the URL we may have created.
        recordPlaybackBreadcrumb({ kind: 'decode-error', id: speech.utteranceId, message: briefError(error) })
        if (url !== null) {
          try {
            URL.revokeObjectURL(url)
          } catch {
            // The URL is already revoked.
          }
        }
        speakWithBrowser()
      }
    }).catch(error => {
      recordPlaybackBreadcrumb({ kind: 'audio-error', id: speech.utteranceId, message: briefError(error) })
      speakWithBrowser()
    })
  }, [speech, audio])

  // Mount/unmount breadcrumbs only. Playback deliberately outlives the mount:
  // cancelling here made every remount cut short or replay the last utterance,
  // which produced the audible repeat loop.
  useEffect(() => {
    recordPlaybackBreadcrumb({ kind: 'mount' })
    return () => {
      recordPlaybackBreadcrumb({ kind: 'unmount' })
    }
  }, [])


  const disabled = settings === undefined || settings.record.enabled !== true
  const label = recording
    ? (mic.phase === 'transcribing' ? '…' : '⏹')
    : '🎙'
  return (
    <button
      type="button"
      data-dsh-talk-mic
      data-recording={recording ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      title={mic.phase === 'error' ? mic.error : undefined}
      disabled={disabled}
      onClick={() => {
        if (recording) stop()
        else start()
      }}
    >
      {label}
    </button>
  )
}
