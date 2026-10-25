/**
 * The `talk` Remote wire vocabulary for the v0.5 surface: status, manual
 * play-latest, stop, the auto/manual mode switch, and the three-field settings
 * save. The descriptor list is shared verbatim by the host `./typert` manifest
 * and the client Remote contribution, so the two faces cannot drift.
 *
 * @module dsh-talk/wire
 */

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

/** The engines the settings panel may select. */
export const TTS_ENGINES = ['minimax', 'mlx'] as const

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
  /** Configured engine. */
  engine: (typeof TTS_ENGINES)[number]
  /** Whether a host synthesis/playback is in flight right now. */
  speaking: boolean
  /** MiniMax system voice id currently configured. */
  voiceId: string
  /** Effective interaction mode (`auto` reads replies aloud, `manual` never does). */
  mode: TalkMode
}

/** Strict wire schema for {@link TalkStatus}. */
export const TALK_STATUS_SCHEMA = z.object({
  engine: z.union([z.literal('minimax'), z.literal('mlx')]),
  speaking: z.boolean(),
  voiceId: z.string(),
  mode: z.enum(['auto', 'manual']),
})

/** Result of `talk/playLatest`: the manual read of the newest assistant reply. */
export interface TalkPlayResult {
  /** Whether something was spoken. */
  spoken: boolean
  /** Engine that spoke (or would have); null when nothing was found. */
  engine: (typeof TTS_ENGINES)[number] | null
  /** The text handed to the engine (sanitized); absent when nothing was found. */
  text?: string
  /** Sanitized failure note; absent on success. */
  error?: string
}

/** Strict wire schema for {@link TalkPlayResult}. */
export const TALK_PLAY_RESULT_SCHEMA = z.object({
  spoken: z.boolean(),
  engine: z.union([z.literal('minimax'), z.literal('mlx'), z.null()]),
  text: z.string().optional(),
  error: z.string().optional(),
})

/** Result of `talk/stop`. */
export interface TalkStopResult {
  /** Whether any in-flight synthesis/playback existed to stop. */
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
export const TALK_MODE_INPUT_SCHEMA = z.object({
  mode: z.enum(['auto', 'manual']),
})

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
  /** Engine selection. */
  engine?: (typeof TTS_ENGINES)[number] | undefined
  /** MiniMax system voice id. */
  voiceId?: string | undefined
  /** Auto-reply read-aloud switch. */
  autoReplyEnabled?: boolean | undefined
}

/** Strict wire schema for {@link TalkSettingsInput}. */
export const TALK_SETTINGS_INPUT_SCHEMA = z.object({
  engine: z.union([z.literal('minimax'), z.literal('mlx')]).optional(),
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
    codec: strictWire('dsh-talk/types#TalkModeInput', TALK_MODE_INPUT_SCHEMA),
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

/** The canonical invocation list both Typert faces register. */
export const TALK_INVOCATIONS = Object.freeze([
  TALK_STATUS_DESCRIPTOR,
  TALK_PLAY_LATEST_DESCRIPTOR,
  TALK_STOP_DESCRIPTOR,
  TALK_APPLY_MODE_DESCRIPTOR,
  TALK_APPLY_SETTINGS_DESCRIPTOR,
])
