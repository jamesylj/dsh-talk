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
import type {
  TalkMode,
  TalkModeResult,
  TalkPendingResult,
  TalkPlayResult,
  TalkSettingsInput,
  TalkSettingsResult,
  TalkStatus,
  TalkStopResult,
} from '../wire.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$talk {
    /** Read-only state snapshot (synthesizing, voice, mode). */
    status: () => Promise<RemoteResult<TalkStatus>>
    /** Synthesize the newest assistant reply of one session and queue it. */
    playLatest: (sessionId: string) => Promise<RemoteResult<TalkPlayResult>>
    /** Abort host synthesis and drop queued utterances. */
    stop: () => Promise<RemoteResult<TalkStopResult>>
    /** Switch the auto/manual read-aloud mode at runtime. */
    applyMode: (mode: TalkMode) => Promise<RemoteResult<TalkModeResult>>
    /** Apply the settings panel's edits as an append-only profile patch operation. */
    applySettings: (settings: TalkSettingsInput) => Promise<RemoteResult<TalkSettingsResult>>
    /** Drain the utterance queue after `since` (`-1` = baseline). */
    pending: (since: number) => Promise<RemoteResult<TalkPendingResult>>
  }
  interface TypertRemoteMap {
    'talk/status': () => Promise<RemoteResult<TalkStatus>>
    'talk/playLatest': (sessionId: string) => Promise<RemoteResult<TalkPlayResult>>
    'talk/stop': () => Promise<RemoteResult<TalkStopResult>>
    'talk/applyMode': (mode: TalkMode) => Promise<RemoteResult<TalkModeResult>>
    'talk/applySettings': (settings: TalkSettingsInput) => Promise<RemoteResult<TalkSettingsResult>>
    'talk/pending': (since: number) => Promise<RemoteResult<TalkPendingResult>>
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
