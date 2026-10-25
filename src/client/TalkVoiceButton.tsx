/**
 * The composer voice button (slot `conversation.input.left`): one click reads
 * the newest assistant reply of the current session aloud on the host; while
 * something is playing, the same click stops it. It replaces the old
 * microphone button: recording/STT and browser playback were removed in v0.5,
 * so the button is purely a host-playback control.
 *
 * @module dsh-talk/client/TalkVoiceButton
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TalkPlayResult, TalkStatus, TalkStopResult } from '../wire.ts'

/** Registration-side injected face: the button's host bindings. */
export interface TalkVoiceInjected {
  /** Read the host state (speaking, engine, voice). */
  status: () => Promise<TalkStatus>
  /** Read the newest assistant reply of one session aloud. */
  playLatest: (sessionId: string) => Promise<TalkPlayResult>
  /** Stop in-flight host playback. */
  stop: () => Promise<TalkStopResult>
}

/** Full component props assembled by the input-slot renderer. */
export type TalkVoiceProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<TalkVoiceInjected>
  // The input-slot standard kit supplies the current session id structurally.
  & { readonly sessionId?: unknown }

/** Poll interval while no playback is active (ms). */
const IDLE_POLL_MS = 2_000

/** Poll interval while playback is active (ms). */
const PLAYING_POLL_MS = 1_000

/**
 * The play/stop button. It never throws into the slot renderer: a failed
 * Remote call just leaves the button idle with a short tooltip.
 *
 * @param props - injected bindings plus the framework standard kit.
 * @returns the button element.
 */
export function TalkVoiceButton(props: TalkVoiceProps): ReactNode {
  const { status, playLatest, stop, sessionId } = props
  const [state, setState] = useState<TalkStatus | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const mounted = useRef(true)

  const speaking = state?.speaking === true
  const sessionKey = typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
  const zh = typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('zh')
  const text = {
    play: zh ? '朗读最近一条回复' : 'Read the latest reply aloud',
    stop: zh ? '停止朗读' : 'Stop speaking',
    busy: zh ? '处理中…' : 'Working…',
    nothing: zh ? '还没有可朗读的回复' : 'No reply to read yet',
    failed: zh ? '语音操作失败' : 'Voice action failed',
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
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
    }
    void poll()
    const timer = setInterval(() => void poll(), speaking ? PLAYING_POLL_MS : IDLE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [status, speaking])

  const onClick = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote(undefined)
    try {
      if (speaking) {
        await stop()
      } else if (sessionKey === undefined) {
        setNote(text.failed)
        return
      } else {
        const result = await playLatest(sessionKey)
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

  const disabled = sessionKey === undefined && !speaking
  const label = busy ? '…' : speaking ? '⏹' : '▶'
  const title = busy ? text.busy : speaking ? text.stop : text.play
  return (
    <button
      type="button"
      data-dsh-talk-voice
      data-speaking={speaking ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      title={note ?? title}
      aria-label={title}
      disabled={disabled || busy}
      onClick={() => void onClick()}
    >
      {label}
    </button>
  )
}
