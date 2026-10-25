/**
 * The composer play/stop button (slot `conversation.input.left`).
 *
 * The Android runtime has no host audio player, so this component is also the
 * plugin's playback surface: it polls `talk/pending` for synthesized utterances,
 * assembles each base64 MP3 into a Blob and plays it through one shared
 * `HTMLAudioElement`. The ▶ click synthesizes the newest reply on the host
 * (`talk/playLatest`); the ⏹ click stops the local audio and aborts/drops the
 * host side with `talk/stop`.
 *
 * Autoplay note: Android WebView may require a user gesture before media may
 * start. The first pointer interaction anywhere in the page unlocks the shared
 * element; if Playback is still refused, the button shows an "(点击页面)" hint
 * and retries on the next gesture.
 *
 * @module dsh-talk/client/TalkVoiceButton
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TalkPendingResult, TalkPlayResult, TalkStatus, TalkStopResult } from '../wire.ts'

/** Registration-side injected face: the button's host bindings. */
export interface TalkVoiceInjected {
  /** Read the host state (synthesizing, mode, voice). */
  status: () => Promise<TalkStatus>
  /** Synthesize the newest assistant reply of one session and queue it. */
  playLatest: (sessionId: string) => Promise<TalkPlayResult>
  /** Abort host synthesis and drop the queued utterances. */
  stop: () => Promise<TalkStopResult>
  /** Drain the utterance queue after `since` (`-1` = baseline). */
  pending: (since: number) => Promise<TalkPendingResult>
  /** Session id delivered to the slot registration's `inject(sessionId)`. */
  sessionKey?: string
}

/** Full component props assembled by the input-slot renderer. */
export type TalkVoiceProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<TalkVoiceInjected>
  // The input-slot standard kit supplies the current session id structurally.
  & { readonly sessionId?: unknown }

/** Queue poll interval while idle or synthesizing (ms). */
const POLL_MS = 800

/** One decoded utterance waiting for its turn on the shared audio element. */
interface QueuedAudio {
  /** Utterance id (diagnostics only). */
  id: string
  /** Blob URL of the MP3. */
  url: string
}

/** One shared audio element for the whole page (one stream: no overlap). */
let sharedAudio: HTMLAudioElement | null = null

/** The lazily created shared audio element. */
function audioElement(): HTMLAudioElement {
  if (sharedAudio === null) {
    sharedAudio = new Audio()
    sharedAudio.preload = 'auto'
  }
  return sharedAudio
}

/** Decode one base64 MP3 into a Blob URL. */
function blobUrl(base64: string, mime: string): string {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

/**
 * The play/stop button. It never throws into the slot renderer: a failed
 * Remote call just leaves the button idle with a short tooltip.
 *
 * @param props - injected bindings plus the framework standard kit.
 * @returns the button element.
 */
export function TalkVoiceButton(props: TalkVoiceProps): ReactNode {
  const { status, playLatest, stop, pending, sessionId, sessionKey: injectedSessionKey } = props
  const [state, setState] = useState<TalkStatus | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const mounted = useRef(true)
  const queueRef = useRef<QueuedAudio[]>([])
  const cursorRef = useRef(-1)
  const playingRef = useRef(false)

  const hostSpeaking = state?.speaking === true
  const speaking = hostSpeaking || playing
  const propSessionKey = typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
  const sessionKey = injectedSessionKey ?? propSessionKey
  const zh = typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('zh')
  const text = {
    play: zh ? '朗读最近一条回复' : 'Read the latest reply aloud',
    stop: zh ? '停止朗读' : 'Stop speaking',
    busy: zh ? '处理中…' : 'Working…',
    nothing: zh ? '还没有可朗读的回复' : 'No reply to read yet',
    failed: zh ? '语音操作失败' : 'Voice action failed',
    blocked: zh ? '点击页面任意处以允许播放语音' : 'Tap anywhere to allow audio playback',
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /** Play the next queued utterance, if any. */
  const playNext = (): void => {
    if (playingRef.current) return
    const next = queueRef.current.shift()
    if (next === undefined) {
      playingRef.current = false
      if (mounted.current) setPlaying(false)
      return
    }
    const element = audioElement()
    playingRef.current = true
    if (mounted.current) setPlaying(true)
    element.src = next.url
    element.play().then(() => {
      if (mounted.current) setBlocked(false)
    }).catch((error: unknown) => {
      const denied = error instanceof Error && error.name === 'NotAllowedError'
      queueRef.current.unshift(next)
      playingRef.current = false
      if (mounted.current) {
        setPlaying(false)
        setBlocked(denied)
      }
    })
  }

  /** Install the shared element's ended handler once. */
  useEffect(() => {
    const element = audioElement()
    const onEnded = (): void => {
      const current = element.src
      if (current.startsWith('blob:')) URL.revokeObjectURL(current)
      playingRef.current = false
      if (mounted.current) setPlaying(false)
      playNext()
    }
    element.addEventListener('ended', onEnded)
    return () => {
      element.removeEventListener('ended', onEnded)
    }
  }, [])

  // Android WebView may gate media on a user gesture: the first pointer
  // interaction anywhere unlocks the shared element so queued auto-reply audio
  // can start without a dedicated tap.
  useEffect(() => {
    const unlock = (): void => {
      const element = audioElement()
      if (element.src === '') element.src = SILENT_WAV
      void element.play().then(() => {
        if (mounted.current) setBlocked(false)
        playNext()
      }).catch(() => undefined)
    }
    document.addEventListener('pointerdown', unlock, { once: true })
    return () => {
      document.removeEventListener('pointerdown', unlock)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const next = await status()
        if (!cancelled && mounted.current) setState(next)
      } catch {
        // A transient Remote failure keeps the last known state.
      }
      try {
        const page = await pending(cursorRef.current)
        if (cancelled || !mounted.current) return
        cursorRef.current = page.cursor
        for (const item of page.items) {
          if (sessionKey !== undefined && item.sessionId !== '' && item.sessionId !== sessionKey) continue
          if (item.mime !== 'audio/mpeg') continue
          queueRef.current.push({ id: item.id, url: blobUrl(item.audioBase64, item.mime) })
        }
        playNext()
      } catch {
        // Keep the last cursor; the next poll retries.
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [status, pending, sessionKey])

  const onClick = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote(undefined)
    try {
      if (speaking) {
        const element = audioElement()
        element.pause()
        if (element.src.startsWith('blob:')) URL.revokeObjectURL(element.src)
        element.removeAttribute('src')
        element.load()
        for (const item of queueRef.current) URL.revokeObjectURL(item.url)
        queueRef.current = []
        playingRef.current = false
        if (mounted.current) setPlaying(false)
        await stop()
      } else {
        // An empty id asks the host for its newest live session; a concrete id
        // (injected by the slot or supplied as a standard prop) is preferred.
        const result = await playLatest(sessionKey ?? '')
        if (!result.spoken) setNote(result.error ?? text.nothing)
      }
      const next = await status()
      if (mounted.current) setState(next)
    } catch {
      if (mounted.current) setNote(text.failed)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const disabled = busy
  const label = busy ? '…' : speaking ? '⏹' : '▶'
  const title = busy ? text.busy : note ?? (blocked ? text.blocked : speaking ? text.stop : text.play)
  return (
    <button
      type="button"
      data-dsh-talk-voice
      data-speaking={speaking ? 'true' : 'false'}
      data-blocked={blocked ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={() => void onClick()}
    >
      {label}
    </button>
  )
}

/** Tiny silent WAV used to unlock the WebView's media element on a gesture. */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
