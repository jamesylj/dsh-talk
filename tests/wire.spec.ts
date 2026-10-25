/**
 * The `talk` Remote wire vocabulary. The one regression this guards: a
 * parameter's codec describes the VALUE the service method receives, and the
 * host calls the method with those values positionally — so `talk/applyMode`
 * must carry the scalar mode, not an object wrapping it.
 *
 * @module dsh-talk/test/wire.spec
 */

import { describe, expect, it } from 'vitest'
import {
  TALK_APPLY_MODE_DESCRIPTOR,
  TALK_INVOCATIONS,
  TALK_MODE_SCHEMA,
  TALK_STATUS_SCHEMA,
  type TalkMode,
} from '../src/wire.ts'

describe('talk/applyMode wire', () => {
  it('declares exactly one scalar mode parameter', () => {
    const parameters = TALK_APPLY_MODE_DESCRIPTOR.parameters
    expect(parameters).toHaveLength(1)
    const [parameter] = parameters
    expect(parameter?.name).toBe('mode')
    expect(parameter?.wire).toBe('mode')
    expect(parameter?.source).toBe('json')
    expect(parameter?.codec.create().parse('manual' satisfies TalkMode)).toBe('manual')
    expect(parameter?.codec.create().safeParse({ mode: 'manual' }).success).toBe(false)
  })

  it('rejects a mode outside the vocabulary', () => {
    expect(TALK_MODE_SCHEMA.safeParse('sometimes').success).toBe(false)
    expect(TALK_MODE_SCHEMA.options).toEqual(['auto', 'manual'])
  })

  it('is listed in the shared invocation descriptors', () => {
    expect(TALK_INVOCATIONS.map(descriptor => descriptor.id)).toContain('dsh-talk#talk/applyMode')
  })
})

describe('talk/status wire', () => {
  it('carries the effective mode and rejects the removed autoReplyEnabled field', () => {
    const status = { engine: 'minimax', speaking: false, voiceId: 'Chinese (Mandarin)_Warm_Girl', mode: 'auto' }
    expect(TALK_STATUS_SCHEMA.parse(status)).toEqual(status)
    expect(TALK_STATUS_SCHEMA.safeParse({ ...status, mode: 'sometimes' }).success).toBe(false)
    expect(TALK_STATUS_SCHEMA.safeParse({ engine: 'minimax', speaking: false, voiceId: 'v' }).success).toBe(false)
  })
})
