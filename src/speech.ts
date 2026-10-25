/**
 * The speech session-log seat. Every utterance the plugin speaks aloud — tool
 * speech, turn-end/approval/error announcements, and the automatic reading of
 * the assistant's final reply — is appended to the session log and the
 * `talk:speech` projection over it drives live playback in the client. The
 * payload carries the utterance id, engine, reason, size, and spoken text, so
 * the voice loop is reconstructable from the session log; the audio bytes
 * themselves stay out of the log and travel only through the `talk/audio`
 * Remote endpoint.
 *
 * Two channels exist because the host vocabulary is not ours to extend:
 * - hosts whose `KNOWN_SESSION_EVENT_TYPES` covers `dsh-talk/speech` (the
 *   legacy contract this plugin was built against) append it plainly;
 * - hosts that instead expose the experimental `appendPluginRecord` API
 *   (0.2.1+) receive an ignorable `plugin:dsh-talk/speech` record. The record
 *   type is outside the released event vocabulary by construction, the marker
 *   makes a cold load keep-and-skip it, and the record never enters the
 *   model-visible surface;
 * - any other host gets no append and the call reports `false`, so the caller
 *   records the degradation (`talk/latest` exposes the per-session counters)
 *   while the `speak` tool results remain the reconstructable audit trail.
 *
 * HARD RULE (measured on the 0.1.6-alpha.2 line): `Session.append`'s third
 * parameter carries a `SurfaceIntent`, and only for surface-eligible event
 * types; it is never an `ignorable` envelope. An out-of-repo non-surface type
 * therefore cannot be stamped through `append`, and an unmarked unknown event
 * makes a later reader refuse the whole stored log — so the source-text probe
 * that used to look for an `ignorable` option was removed and must not come
 * back in any form (least of all as an unconditional append).
 *
 * @module dsh-talk/speech
 */

import * as sessionPkg from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { DshTalkSpeechEvent } from './vocabulary.ts'

export type { DshTalkSpeechEvent, SpeechReason, SpeechTtsEngine } from './vocabulary.ts'

/** The plain speech session event type (legacy host vocabulary). */
export const SPEECH_EVENT = 'dsh-talk/speech' as const

/** The experimental plugin-record name used when the host does not know {@link SPEECH_EVENT}. */
export const SPEECH_RECORD = 'plugin:dsh-talk/speech' as const

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'dsh-talk/speech': DshTalkSpeechEvent
  }
}

/** Structural face of the host's experimental `appendPluginRecord(session, type, data)` export. */
type PluginRecordAppender = (session: Session, type: string, data: unknown) => unknown

/**
 * Read the host's `appendPluginRecord` without a named import: a bare named
 * import of a host export that a given host line does not publish makes the
 * whole module fail to link, so the API is feature-detected through a
 * namespace import instead.
 *
 * @returns the appender when this host publishes one, `undefined` otherwise.
 */
function pluginRecordAppender(): PluginRecordAppender | undefined {
  const candidate = (sessionPkg as Record<string, unknown>)['appendPluginRecord']
  return typeof candidate === 'function' ? (candidate as PluginRecordAppender) : undefined
}

/**
 * Append one speech utterance through the channel this host publishes.
 *
 * @param session - the calling session.
 * @param data - the speech event payload.
 * @returns `true` when the utterance reached the log (plain event or plugin
 *   record), `false` when this host can carry neither (the caller records the
 *   skip so the degradation stays observable).
 */
export function appendSpeechEvent(session: Session, data: DshTalkSpeechEvent): boolean {
  const knownTypes = (sessionPkg as Record<string, unknown>)['KNOWN_SESSION_EVENT_TYPES'] as ReadonlySet<string> | undefined
  return appendSpeechEventWith(session, data, { knownTypes, appendRecord: pluginRecordAppender() })
}

/** Host capabilities one speech append may use; every field is feature-detected. */
export interface SpeechHostChannels {
  /** The host's known-event vocabulary, when it publishes one. */
  readonly knownTypes?: ReadonlySet<string> | undefined
  /** The host's experimental plugin-record appender, when it publishes one. */
  readonly appendRecord?: PluginRecordAppender | undefined
}

/**
 * Channel selection without touching the host module: used by
 * {@link appendSpeechEvent} with the detected host and directly by tests that
 * need to stand in for a host with different capabilities.
 *
 * @param session - the target session.
 * @param data - the speech event payload.
 * @param host - detected (or injected) host channels.
 * @returns whether the utterance reached the log.
 */
export function appendSpeechEventWith(session: Session, data: DshTalkSpeechEvent, host: SpeechHostChannels): boolean {
  if (host.knownTypes?.has(SPEECH_EVENT) === true) {
    session.append(SPEECH_EVENT, data)
    return true
  }
  if (host.appendRecord === undefined) return false
  host.appendRecord(session, SPEECH_RECORD, data)
  return true
}
