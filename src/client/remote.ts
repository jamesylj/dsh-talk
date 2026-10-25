/**
 * The client-side Remote face of the `talk` namespace: the hand-written
 * `TypertRemoteContribution` mounted through `ctx.remote.$mount`, plus the
 * declaration merging that types `ctx.remote.talk`. The descriptor list is
 * shared with the host `./typert` manifest (`../wire.ts`).
 *
 * @module dsh-talk/client/remote
 */

import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { TALK_INVOCATIONS } from '../wire.ts'
import type { TalkPlayResult, TalkSettingsInput, TalkSettingsResult, TalkStatus, TalkStopResult } from '../wire.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$talk {
    /** Read-only state snapshot (engine, speaking, voice, auto-reply switch). */
    status: () => Promise<RemoteResult<TalkStatus>>
    /** Read the newest assistant reply of one session aloud on the host. */
    playLatest: (sessionId: string) => Promise<RemoteResult<TalkPlayResult>>
    /** Stop in-flight host playback. */
    stop: () => Promise<RemoteResult<TalkStopResult>>
    /** Apply the settings panel's edits as an append-only profile patch operation. */
    applySettings: (settings: TalkSettingsInput) => Promise<RemoteResult<TalkSettingsResult>>
  }
  interface TypertRemoteMap {
    'talk/status': () => Promise<RemoteResult<TalkStatus>>
    'talk/playLatest': (sessionId: string) => Promise<RemoteResult<TalkPlayResult>>
    'talk/stop': () => Promise<RemoteResult<TalkStopResult>>
    'talk/applySettings': (settings: TalkSettingsInput) => Promise<RemoteResult<TalkSettingsResult>>
  }
  interface TypertRemoteNamespaceMap {
    talk: TypertRemoteNamespace$talk
  }
}

/** The client Remote contribution for the `talk` namespace. */
export const TALK_REMOTE = Object.freeze({
  package: 'dsh-talk',
  descriptors: TALK_INVOCATIONS,
} satisfies TypertRemoteContribution)
