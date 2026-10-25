/**
 * The `talk` Remote wire vocabulary: descriptor shapes the host dispatch relies
 * on (a descriptor's `method` must name a real service method, and a parameter
 * codec describes the VALUE the method receives).
 *
 * @module dsh-talk/test/wire.spec
 */

import { describe, expect, it } from 'vitest'
import {
  TALK_APPLY_MODE_DESCRIPTOR,
  TALK_INVOCATIONS,
  TALK_MODE_INPUT_SCHEMA,
  TALK_PENDING_DESCRIPTOR,
  TALK_STATUS_SCHEMA,
  type TalkMode,
} from '../src/wire.ts'

describe('talk wire', () => {
  it('declares exactly the six android invocation methods', () => {
    expect(TALK_INVOCATIONS.map(descriptor => descriptor.method)).toEqual([
      'status',
      'playLatest',
      'stop',
      'applyMode',
      'applySettings',
      'pending',
    ])
  })

  it('carries a scalar mode parameter for applyMode', () => {
    const [parameter] = TALK_APPLY_MODE_DESCRIPTOR.parameters
    expect(parameter?.wire).toBe('mode')
    expect(parameter?.codec.create().parse('manual' satisfies TalkMode)).toBe('manual')
    expect(TALK_MODE_INPUT_SCHEMA.options).toEqual(['auto', 'manual'])
    expect(TALK_MODE_INPUT_SCHEMA.safeParse('sometimes').success).toBe(false)
  })

  it('carries a scalar cursor parameter for pending', () => {
    const [parameter] = TALK_PENDING_DESCRIPTOR.parameters
    expect(parameter?.wire).toBe('since')
    expect(parameter?.codec.create().parse(-1)).toBe(-1)
    expect(parameter?.codec.create().safeParse('1').success).toBe(false)
  })

  it('status carries the mode and the synthesizing flag', () => {
    const status = { speaking: false, voiceId: 'Chinese (Mandarin)_Warm_Girl', mode: 'auto' }
    expect(TALK_STATUS_SCHEMA.parse(status)).toEqual(status)
    expect(TALK_STATUS_SCHEMA.safeParse({ ...status, mode: 'sometimes' }).success).toBe(false)
    expect(TALK_STATUS_SCHEMA.safeParse({ engine: 'minimax', speaking: false, voiceId: 'v' }).success).toBe(false)
  })
})
