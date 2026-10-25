/**
 * The simplified talk settings tab (id `talk` in `settings.plugins.tab`):
 * engine select (MiniMax / MLX), the MiniMax voice id, and the auto-reply
 * read-aloud switch, saved as one append-only profile-patch operation. The
 * switch mirrors the composer mode button's effective mode, so the two
 * controls always agree; saving persists the mode as the new default.
 *
 * @module dsh-talk/client/TalkSettingsTab
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TalkMode, TalkSettingsInput, TalkSettingsResult, TalkStatus } from '../wire.ts'

/** Registration-side injected face: the settings RPCs (RemoteResult unwrapped). */
export interface TalkSettingsTabInjected {
  /** Read the current settings snapshot. */
  status: () => Promise<TalkStatus>
  /** Append the panel's edits to the profile patch layer. */
  applySettings: (settings: TalkSettingsInput) => Promise<TalkSettingsResult>
}

/** Full component props assembled by the Settings slot renderer. */
export type TalkSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.talk'>
  & InjectFace<TalkSettingsTabInjected>

/**
 * The tab body: reads the snapshot once, edits locally, and saves through the
 * host. The note tells the user to reload the profile for the changes.
 *
 * @param props - injected bindings plus the framework seats.
 * @returns the settings form.
 */
export function TalkSettingsTab(props: TalkSettingsTabProps): ReactNode {
  const { status, applySettings, t } = props
  const [snapshot, setSnapshot] = useState<TalkStatus | undefined>(undefined)
  const [engine, setEngine] = useState<TalkStatus['engine']>('minimax')
  const [voiceId, setVoiceId] = useState('')
  const [mode, setMode] = useState<TalkMode>('auto')
  const [note, setNote] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void status().then(value => {
      if (cancelled) return
      setSnapshot(value)
      setEngine(value.engine)
      setVoiceId(value.voiceId)
      setMode(value.mode)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [status])

  if (snapshot === undefined) return null

  const save = (): void => {
    setFailed(false)
    void applySettings({ engine, voiceId: voiceId.trim(), autoReplyEnabled: mode === 'auto' }).then(result => {
      setNote(result.note)
    }).catch(() => {
      setFailed(true)
      setNote(undefined)
    })
  }

  return (
    <div data-dsh-talk-settings>
      <label>
        {t('engine')}
        <select value={engine} onChange={event => setEngine(event.target.value as TalkStatus['engine'])}>
          <option value="minimax">minimax</option>
          <option value="mlx">mlx</option>
        </select>
      </label>
      <label>
        {t('voiceId')}
        <input type="text" value={voiceId} onChange={event => setVoiceId(event.target.value)} />
      </label>
      <div className="row">
        <input
          type="checkbox"
          checked={mode === 'auto'}
          onChange={event => setMode(event.target.checked ? 'auto' : 'manual')}
        />
        {t('autoReplyEnabled')}
      </div>
      <button type="button" onClick={save}>{t('save')}</button>
      {note !== undefined ? <div className="note">{note}</div> : null}
      {failed ? <div className="note">{t('saveFailed')}</div> : null}
    </div>
  )
}
