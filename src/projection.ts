/**
 * The `talk:speech` session-projection unit: a last-wins fold of speech events
 * into one whole value per session. The web client's session-scoped record
 * button reads the value through `useProjection` and plays each fresh utterance
 * (audio fetched through `talk/audio`, or spoken by the browser voice for the
 * browser engine). Pure mathematics only — the projection registry owns the
 * drive and notification. Imports the pure `/types` outlet of dsh-session
 * (never its root), so the client program can pull the `SessionProjectionMap`
 * merge in without host `Context` merges.
 *
 * Two event types fold into the one value: the plain `dsh-talk/speech` event on
 * hosts whose known vocabulary covers it, and the experimental
 * `plugin:dsh-talk/speech` record every 0.2.1+ host carries instead. A plugin
 * record is restored from arbitrary JSON written by an earlier build of this
 * plugin, so its payload is validated before it can reach the wire.
 *
 * @module dsh-talk/projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  talkSpeechEventPayloadSchema as talkSpeechPayloadSchema,
  talkSpeechProjectionSchema as talkSpeechValueSchema,
} from './vocabulary.ts'
import type { TalkSpeechProjection } from './vocabulary.ts'

export type { TalkSpeechProjection } from './vocabulary.ts'

/** Every log event type that carries one speech payload. */
const SPEECH_EVENT_TYPES: ReadonlySet<string> = new Set(['dsh-talk/speech', 'plugin:dsh-talk/speech'])

/** State schema for the projection registry: the value or null before the first speech event. */
export const talkSpeechProjectionSchema = z.union([talkSpeechValueSchema, z.null()])

/** Unit state: the latest speech event, or null for an empty log. */
export type TalkSpeechProjectionState = TalkSpeechProjection | null

/** State for the empty log. */
export function initTalkSpeechProjection(): TalkSpeechProjectionState {
  return null
}

/**
 * Validate the payload of one speech-bearing log event.
 *
 * @param event - one committed session event (plain event or plugin record).
 * @returns the validated payload, or `undefined` when this event is not a
 *   speech event (or its restored plugin record carries an unusable body).
 */
function speechPayloadOf(event: SessionEvent): TalkSpeechProjection | undefined {
  // Plugin records are outside `SessionEventMap` by construction, so the
  // runtime type is compared as a plain string instead of through `event.type`.
  if (!SPEECH_EVENT_TYPES.has(String(event.type))) return undefined
  const parsed = talkSpeechPayloadSchema.safeParse(event.data)
  if (!parsed.success) return undefined
  const payload = parsed.data
  return { seq: event.seq, ...payload }
}

/**
 * Pure transition: a speech event replaces the whole state; every other event —
 * including a malformed restored plugin record — returns the same reference so
 * the drive does zero work.
 *
 * @param state - the state covering all prior events.
 * @param event - the next committed session event.
 * @returns the next state (same reference when the event is not usable speech).
 */
export function applyTalkSpeechProjection(state: TalkSpeechProjectionState, event: SessionEvent): TalkSpeechProjectionState {
  const next = speechPayloadOf(event)
  if (next === undefined) return state
  return {
    seq: next.seq,
    utteranceId: next.utteranceId,
    engine: next.engine,
    text: next.text,
    audioBytes: next.audioBytes,
    reason: next.reason,
    ...(next.error !== undefined ? { error: next.error } : {}),
    ...(next.interrupted === true ? { interrupted: true } : {}),
    ...(next.voice !== undefined ? { voice: next.voice } : {}),
    ...(next.rate !== undefined ? { rate: next.rate } : {}),
    ...(next.pitch !== undefined ? { pitch: next.pitch } : {}),
  }
}

/** State → wire payload (the state already matches the wire shape). */
export function viewTalkSpeechProjection(state: TalkSpeechProjectionState): TalkSpeechProjection | null {
  return state
}

/** Cache-invalidation version for the persisted projection cache. */
export const TALK_SPEECH_PROJECTION_STATE_VERSION = 2

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'talk:speech': TalkSpeechProjection | null
  }
  interface SessionProjectionStateMap {
    'talk:speech': TalkSpeechProjectionState
  }
}
