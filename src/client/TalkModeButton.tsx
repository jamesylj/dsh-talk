/**
 * The composer mode button (slot `conversation.input.left`, right after the
 * play/stop button): one click switches the interaction mode between `auto`
 * (every finished reply is read aloud automatically) and `manual` (the plugin
 * stays silent; only the ▶ button reads). The switch is runtime state owned by
 * the host `TalkService` — no config write, no profile reload — and a restart
 * falls back to the configured `autoReply.enabled` default.
 *
 * @module dsh-talk/client/TalkModeButton
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TalkMode, TalkModeResult, TalkStatus } from '../wire.ts'

/** Registration-side injected face: the mode button's host bindings. */
export interface TalkModeInjected {
  /** Read the host state (current mode). */
  status: () => Promise<TalkStatus>
  /** Switch the interaction mode on the host. */
  applyMode: (mode: TalkMode) => Promise<TalkModeResult>
}

/** Full component props assembled by the input-slot renderer. */
export type TalkModeProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<TalkModeInjected>

/** Poll interval for the mode snapshot (ms). */
const MODE_POLL_MS = 3_000

/**
 * The auto/manual mode pill. It never throws into the slot renderer: a failed
 * Remote call reverts the optimistic label and keeps the last known mode.
 *
 * @param props - injected bindings plus the framework standard kit.
 * @returns the mode button element.
 */
export function TalkModeButton(props: TalkModeProps): ReactNode {
  const { status, applyMode } = props
  const [mode, setMode] = useState<TalkMode | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const mounted = useRef(true)

  const zh = typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('zh')
  const text = {
    auto: zh ? '自动' : 'Auto',
    manual: zh ? '手动' : 'Manual',
    toManual: zh ? '当前：自动朗读，点击切换为手动' : 'Auto read-aloud — click for manual',
    toAuto: zh ? '当前：手动朗读，点击切换为自动' : 'Manual read-aloud — click for auto',
    failed: zh ? '模式切换失败' : 'Could not switch mode',
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
        if (!cancelled && mounted.current) setMode(next.mode)
      } catch {
        // A transient Remote failure keeps the last known mode.
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), MODE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [status])

  const onClick = async (): Promise<void> => {
    if (busy || mode === undefined) return
    const next: TalkMode = mode === 'auto' ? 'manual' : 'auto'
    setBusy(true)
    setNote(undefined)
    setMode(next)
    try {
      const result = await applyMode(next)
      if (mounted.current) setMode(result.mode)
    } catch {
      if (mounted.current) {
        setMode(mode)
        setNote(text.failed)
      }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const current = mode ?? 'auto'
  const label = mode === undefined ? '…' : current === 'auto' ? text.auto : text.manual
  const title = note ?? (current === 'auto' ? text.toManual : text.toAuto)
  return (
    <button
      type="button"
      data-dsh-talk-mode
      data-mode={current}
      title={title}
      aria-label={title}
      aria-pressed={current === 'auto'}
      disabled={mode === undefined || busy}
      onClick={() => void onClick()}
    >
      {label}
    </button>
  )
}
