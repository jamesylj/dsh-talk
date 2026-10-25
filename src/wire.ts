/**
 * The `talk` Remote wire vocabulary for the `android` branch: status, manual
 * play-latest, stop, the auto/manual mode switch, the two-field settings save,
 * and the utterance queue the Web UI drains to play audio.
 *
 * The engine is fixed (MiniMax); audio is synthesized on the host and handed to
 * the client in {@link TalkPendingResult} items as base64 MP3, because the
 * Android runtime has no local audio player for the host to drive.
 *
 * @module dsh-talk/wire
 */

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

/** The two interaction modes the composer mode button switches between. */
export const TALK_MODES = ['auto', 'manual'] as const

/** Auto read-aloud mode: `auto` reads every reply, `manual` only on the button. */
export type TalkMode = (typeof TALK_MODES)[number]

/** Strict wire codec carrying both the published and checkout Typert faces. */
function strictWire<T>(typeSymbol: string, schema: T) {
  return Object.freeze({ mode: 'strict' as const, typeSymbol, schema, create: () => schema })
}

/** Read-only state served by `talk/status`. */
export interface TalkStatus {
  /** Whether a host synthesis is in flight right now (playback happens client-side). */
  speaking: boolean
  /** MiniMax system voice id currently configured. */
  voiceId: string
  /** Effective interaction mode (`auto` reads replies aloud, `manual` never does). */
  mode: TalkMode
}

/** Strict wire schema for {@link TalkStatus}. */
export const TALK_STATUS_SCHEMA = z.object({
  speaking: z.boolean(),
  voiceId: z.string(),
  mode: z.enum(['auto', 'manual']),
})

/** Result of `talk/playLatest`: the manual read of the newest assistant reply. */
export interface TalkPlayResult {
  /** Whether the utterance was synthesized and queued for playback. */
  spoken: boolean
  /** Engine that spoke (or would have); null when nothing was found. */
  engine: 'minimax' | null
  /** The text handed to the engine (sanitized); absent when nothing was found. */
  text?: string
  /** Utterance id the client will receive through `talk/pending`. */
  utteranceId?: string
  /** Sanitized failure note; absent on success. */
  error?: string
}

/** Strict wire schema for {@link TalkPlayResult}. */
export const TALK_PLAY_RESULT_SCHEMA = z.object({
  spoken: z.boolean(),
  engine: z.union([z.literal('minimax'), z.null()]),
  text: z.string().optional(),
  utteranceId: z.string().optional(),
  error: z.string().optional(),
})

/** Result of `talk/stop`. */
export interface TalkStopResult {
  /** Whether any in-flight synthesis or queued utterance existed to drop. */
  stopped: boolean
}

/** Strict wire schema for {@link TalkStopResult}. */
export const TALK_STOP_RESULT_SCHEMA = z.object({
  stopped: z.boolean(),
})

/** The composer mode button's submission. */
export interface TalkModeInput {
  /** The mode to switch to. */
  mode: TalkMode
}

/** Strict wire schema for {@link TalkModeInput}. */
export const TALK_MODE_INPUT_SCHEMA = z.enum(['auto', 'manual'])

/** Result of `talk/applyMode`: the effective mode after the switch. */
export interface TalkModeResult {
  /** The mode now in force. */
  mode: TalkMode
}

/** Strict wire schema for {@link TalkModeResult}. */
export const TALK_MODE_RESULT_SCHEMA = z.object({
  mode: z.enum(['auto', 'manual']),
})

/** Settings the panel may change. */
export interface TalkSettingsInput {
  /** MiniMax system voice id. */
  voiceId?: string | undefined
  /** Auto-reply read-aloud switch. */
  autoReplyEnabled?: boolean | undefined
}

/** Strict wire schema for {@link TalkSettingsInput}. */
export const TALK_SETTINGS_INPUT_SCHEMA = z.object({
  voiceId: z.string().optional(),
  autoReplyEnabled: z.boolean().optional(),
})

/** Result of `talk/applySettings`: the appended patch operation. */
export interface TalkSettingsResult {
  /** Absolute file the fragment was appended to. */
  file: string
  /** Bytes appended. */
  bytes: number
  /** What the user should do next (reload note). */
  note: string
}

/** Strict wire schema for {@link TalkSettingsResult}. */
export const TALK_SETTINGS_RESULT_SCHEMA = z.object({
  file: z.string(),
  bytes: z.number().int(),
  note: z.string(),
})

/** One synthesized utterance waiting for the Web UI to play. */
export interface TalkUtterance {
  /** Stable utterance id. */
  id: string
  /** Monotonic queue position (`talk/pending` cursor). */
  seq: number
  /** Session the utterance belongs to. */
  sessionId: string
  /** The spoken text (sanitized). */
  text: string
  /** Audio MIME type (`audio/mpeg`). */
  mime: string
  /** Base64-encoded MP3 bytes. */
  audioBase64: string
  /** Decoded audio size in bytes. */
  bytes: number
}

/** Strict wire schema for {@link TalkUtterance}. */
export const TALK_UTTERANCE_SCHEMA = z.object({
  id: z.string(),
  seq: z.number().int(),
  sessionId: z.string(),
  text: z.string(),
  mime: z.string(),
  audioBase64: z.string(),
  bytes: z.number().int(),
})

/** Result of `talk/pending`: the queue tail the client has not played yet. */
export interface TalkPendingResult {
  /** Current queue cursor; echo it back on the next call. */
  cursor: number
  /** Utterances with `seq > since` (empty for the baseline call). */
  items: readonly TalkUtterance[]
}

/** Strict wire schema for {@link TalkPendingResult}. */
export const TALK_PENDING_RESULT_SCHEMA = z.object({
  cursor: z.number().int(),
  items: z.array(TALK_UTTERANCE_SCHEMA),
})

/** Frozen source position both faces carry (diagnostics only). */
const SOURCE = Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 })

/** The `talk/status` invocation descriptor. */
export const TALK_STATUS_DESCRIPTOR = Object.freeze({
  id: 'dsh-talk#talk/status',
  service: 'talk',
  namespace: 'talk',
  method: 'status',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([]),
  result: strictWire('dsh-talk/types#TalkStatus', TALK_STATUS_SCHEMA),
  sourceLocation: SOURCE,
} as const) satisfies InvocationDescriptor

/** The `talk/playLatest` invocation descriptor. */
export const TALK_PLAY_LATEST_DESCRIPTOR = Object.freeze({
  id: 'dsh-talk#talk/playLatest',
  service: 'talk',
  namespace: 'talk',
  method: 'playLatest',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([Object.freeze({
    name: 'sessionId',
    wire: 'sessionId',
    source: 'json',
    codec: strictWire('dsh-talk/types#TalkPlayLatestSessionId', z.string()),
  } satisfies InvocationDescriptor['parameters'][number])]),
  result: strictWire('dsh-talk/types#TalkPlayResult', TALK_PLAY_RESULT_SCHEMA),
  sourceLocation: SOURCE,
} as const) satisfies InvocationDescriptor

/** The `talk/stop` invocation descriptor. */
export const TALK_STOP_DESCRIPTOR = Object.freeze({
  id: 'dsh-talk#talk/stop',
  service: 'talk',
  namespace: 'talk',
  method: 'stop',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([]),
  result: strictWire('dsh-talk/types#TalkStopResult', TALK_STOP_RESULT_SCHEMA),
  sourceLocation: SOURCE,
} as const) satisfies InvocationDescriptor

/** The `talk/applyMode` invocation descriptor. */
export const TALK_APPLY_MODE_DESCRIPTOR = Object.freeze({
  id: 'dsh-talk#talk/applyMode',
  service: 'talk',
  namespace: 'talk',
  method: 'applyMode',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([Object.freeze({
    name: 'mode',
    wire: 'mode',
    source: 'json',
    codec: strictWire('dsh-talk/types#TalkMode', TALK_MODE_INPUT_SCHEMA),
  } satisfies InvocationDescriptor['parameters'][number])]),
  result: strictWire('dsh-talk/types#TalkModeResult', TALK_MODE_RESULT_SCHEMA),
  sourceLocation: SOURCE,
} as const) satisfies InvocationDescriptor

/** The `talk/applySettings` invocation descriptor. */
export const TALK_APPLY_SETTINGS_DESCRIPTOR = Object.freeze({
  id: 'dsh-talk#talk/applySettings',
  service: 'talk',
  namespace: 'talk',
  method: 'applySettings',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([Object.freeze({
    name: 'settings',
    wire: 'settings',
    source: 'json',
    codec: strictWire('dsh-talk/types#TalkSettingsInput', TALK_SETTINGS_INPUT_SCHEMA),
  } satisfies InvocationDescriptor['parameters'][number])]),
  result: strictWire('dsh-talk/types#TalkSettingsResult', TALK_SETTINGS_RESULT_SCHEMA),
  sourceLocation: SOURCE,
} as const) satisfies InvocationDescriptor

/** The `talk/pending` invocation descriptor. */
export const TALK_PENDING_DESCRIPTOR = Object.freeze({
  id: 'dsh-talk#talk/pending',
  service: 'talk',
  namespace: 'talk',
  method: 'pending',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([Object.freeze({
    name: 'since',
    wire: 'since',
    source: 'json',
    codec: strictWire('dsh-talk/types#TalkPendingSince', z.number().int()),
  } satisfies InvocationDescriptor['parameters'][number])]),
  result: strictWire('dsh-talk/types#TalkPendingResult', TALK_PENDING_RESULT_SCHEMA),
  sourceLocation: SOURCE,
} as const) satisfies InvocationDescriptor

/** The canonical invocation list both Typert faces register. */
export const TALK_INVOCATIONS = Object.freeze([
  TALK_STATUS_DESCRIPTOR,
  TALK_PLAY_LATEST_DESCRIPTOR,
  TALK_STOP_DESCRIPTOR,
  TALK_APPLY_MODE_DESCRIPTOR,
  TALK_APPLY_SETTINGS_DESCRIPTOR,
  TALK_PENDING_DESCRIPTOR,
])
