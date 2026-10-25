/**
 * `dsh-talk`, browser half: mounts the `talk` Remote contribution, registers
 * the composer auto/manual mode button plus the play/stop voice button into
 * `conversation.input.left`, and the simplified settings tab
 * (`settings.plugins.tab`, id `talk`). All data arrives through the
 * `remote.talk` namespace.
 *
 * @module dsh-talk/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TalkSettingsTabInjected } from './TalkSettingsTab.tsx'
import { TalkSettingsTab } from './TalkSettingsTab.tsx'
import type { TalkModeInjected } from './TalkModeButton.tsx'
import { TalkModeButton } from './TalkModeButton.tsx'
import type { TalkVoiceInjected } from './TalkVoiceButton.tsx'
import { TalkVoiceButton } from './TalkVoiceButton.tsx'
import { en, zh, type TalkLocaleKey } from './locales.ts'
import { TALK_REMOTE } from './remote.ts'
import { installTalkStyles } from './styles.ts'
import type {
  TalkMode,
  TalkModeResult,
  TalkPlayResult,
  TalkSettingsInput,
  TalkSettingsResult,
  TalkStatus,
  TalkStopResult,
} from '../wire.ts'

export type { TalkModeInjected, TalkModeProps } from './TalkModeButton.tsx'
export type { TalkVoiceInjected, TalkVoiceProps } from './TalkVoiceButton.tsx'
export type { TalkSettingsTabInjected, TalkSettingsTabProps } from './TalkSettingsTab.tsx'
export type { TalkLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Voice-loop settings copy. */
    'settings.talk': TalkLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.talk'

/** Plugin name: matches the package name, the graph row id, and the bundle id. */
export const name = 'dsh-talk'

/** Services the browser half reads; `remote.talk` appears once the contribution mounts. */
export const inject = ['slots', 'locale', 'remote']

/** Minimal structural contract of the slot registry this client uses. */
interface SlotsFace {
  inject(slot: string, factory: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): unknown
}

/**
 * Browser plugin body: dictionaries, the scoped stylesheet, the Remote
 * contribution mount, the voice button slot, and the settings tab.
 *
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-talk: dictionaries')
  ctx.effect(() => installTalkStyles(), 'dsh-talk: stylesheet')

  await ctx.remote.$mount(TALK_REMOTE)

  const slots = ctx.get('slots') as SlotsFace
  ctx.inject(['remote.talk'], (scope) => {
    const talk = scope.remote.talk
    const t = scope.locale.bind(NS)
    const unwrap = <T>(result: RemoteResult<T>, method: string): T => {
      if (!result.ok) {
        throw new Error(`talk.${method} failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    }
    const status: TalkVoiceInjected['status'] = async () =>
      unwrap<TalkStatus>(await talk.status(), 'status')
    const playLatest: TalkVoiceInjected['playLatest'] = async (sessionId) =>
      unwrap<TalkPlayResult>(await talk.playLatest(sessionId), 'playLatest')
    const stop: TalkVoiceInjected['stop'] = async () =>
      unwrap<TalkStopResult>(await talk.stop(), 'stop')
    const applyMode: TalkModeInjected['applyMode'] = async (mode: TalkMode) =>
      unwrap<TalkModeResult>(await talk.applyMode(mode), 'applyMode')
    const applySettings: TalkSettingsTabInjected['applySettings'] = async (settings: TalkSettingsInput) =>
      unwrap<TalkSettingsResult>(await talk.applySettings(settings), 'applySettings')

    slots.inject('conversation.input.left', () => slots.register({
      name: 'conversation.input.left',
      id: 'talk-mode',
      order: 19,
      inject: (): TalkModeInjected => ({ status, applyMode }),
    }, TalkModeButton))

    slots.inject('conversation.input.left', () => slots.register({
      name: 'conversation.input.left',
      id: 'talk-voice',
      order: 20,
      inject: (): TalkVoiceInjected => ({ status, playLatest, stop }),
    }, TalkVoiceButton))

    slots.inject('settings.plugins.tab', () => slots.register({
      name: 'settings.plugins.tab',
      id: 'talk',
      order: 50,
      label: () => t('tab'),
      locale: NS,
      inject: (): TalkSettingsTabInjected => ({ status, applySettings }),
    }, TalkSettingsTab))
  })
}
