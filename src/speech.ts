/**
 * Speech session-log seat. Every utterance this plugin speaks aloud — the
 * `speak` tool, the automatic reply read-aloud, the manual play button and the
 * turn-end announcement — is appended to the session log so the voice loop is
 * reconstructable (`plugin:dsh-talk/speech` records on current hosts; the
 * legacy plain `dsh-talk/speech` event on hosts whose vocabulary knows it).
 *
 * Audio bytes never enter the log: the host played the audio itself, and the
 * optional export file path rides the speak outcome instead.
 *
 * @module dsh-talk/speech
 */

import * as sessionPkg from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'

/** What triggered one spoken utterance. */
export type SpeechReason = 'speak-tool' | 'turn-end' | 'auto-reply' | 'manual'

/** Engines that can synthesize speech in this plugin. */
export type SpeechTtsEngine = 'minimax' | 'mlx'

/** Payload of one speech session event. */
export interface DshTalkSpeechEvent {
  /** Always `tts` — a host-synthesized utterance. */
  kind: 'tts'
  /** Stable id of the utterance. */
  utteranceId: string
  /** Engine that produced the audio. */
  engine: SpeechTtsEngine
  /** The spoken text, sanitized and capped. */
  text: string
  /** Synthesized audio size in bytes. */
  audioBytes: number
  /** What triggered the utterance. */
  reason: SpeechReason
  /** Sanitized failure note; absent on success. */
  error?: string
  /** True when the utterance was interrupted. */
  interrupted?: true
}

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
 * @returns `true` when the utterance reached the log, `false` when this host
 *   can carry neither channel.
 */
export function appendSpeechEvent(session: Session, data: DshTalkSpeechEvent): boolean {
  const knownTypes = (sessionPkg as Record<string, unknown>)['KNOWN_SESSION_EVENT_TYPES'] as ReadonlySet<string> | undefined
  if (knownTypes?.has(SPEECH_EVENT) === true) {
    session.append(SPEECH_EVENT, data)
    return true
  }
  const appendRecord = pluginRecordAppender()
  if (appendRecord === undefined) return false
  appendRecord(session, SPEECH_RECORD, data)
  return true
}
