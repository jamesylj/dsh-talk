/**
 * The talk:speech projection unit: pure fold over speech events, null
 * before the first, and the state schema accepting both shapes.
 *
 * @module dsh-talk/test/projection.spec
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  applyTalkSpeechProjection,
  initTalkSpeechProjection,
  talkSpeechProjectionSchema,
  viewTalkSpeechProjection,
} from '../src/projection.ts'

function speechEvent(seq: number, utteranceId: string) {
  return {
    seq,
    type: 'dsh-talk/speech',
    data: {
      kind: 'tts',
      utteranceId,
      engine: 'edge-tts',
      text: 'Turn complete.',
      audioBytes: 12,
      reason: 'turn-end',
    },
  } as unknown as SessionEvent
}

function browserSpeechEvent(seq: number, utteranceId: string) {
  return {
    seq,
    type: 'dsh-talk/speech',
    data: {
      kind: 'tts',
      utteranceId,
      engine: 'browser',
      text: 'Hello.',
      audioBytes: 0,
      reason: 'speak-tool',
      voice: 'Google UK English Female',
      rate: 1.2,
      pitch: 0.9,
    },
  } as unknown as SessionEvent
}

function pluginRecordEvent(seq: number, utteranceId: string, data?: Record<string, unknown>) {
  return {
    seq,
    type: 'plugin:dsh-talk/speech',
    ignorable: true,
    data: data ?? {
      kind: 'tts',
      utteranceId,
      engine: 'edge-tts',
      text: 'Auto-replied.',
      audioBytes: 24,
      reason: 'auto-reply',
    },
  } as unknown as SessionEvent
}

function malformedPluginRecordEvent(seq: number) {
  return {
    seq,
    type: 'plugin:dsh-talk/speech',
    ignorable: true,
    data: { kind: 'tts', utteranceId: 42, engine: 'edge-tts', text: 'nope', audioBytes: 'x', reason: 'auto-reply' },
  } as unknown as SessionEvent
}

describe('talk:speech projection', () => {
  it('starts at null', () => {
    expect(initTalkSpeechProjection()).toBeNull()
  })

  it('folds the latest speech event and ignores everything else', () => {
    let state = initTalkSpeechProjection()
    const other = { seq: 1, type: 'user/message', data: {} } as unknown as SessionEvent
    expect(applyTalkSpeechProjection(state, other)).toBe(state)
    state = applyTalkSpeechProjection(state, speechEvent(2, 'u-1'))
    expect(state?.utteranceId).toBe('u-1')
    expect(state?.text).toBe('Turn complete.')
    state = applyTalkSpeechProjection(state, speechEvent(3, 'u-2'))
    expect(state?.utteranceId).toBe('u-2')
  })

  it('views the state as itself', () => {
    const state = applyTalkSpeechProjection(initTalkSpeechProjection(), speechEvent(2, 'u-1'))
    expect(viewTalkSpeechProjection(state)).toBe(state)
    expect(viewTalkSpeechProjection(null)).toBeNull()
  })

  it('folds browser delivery settings through the projection', () => {
    const state = applyTalkSpeechProjection(initTalkSpeechProjection(), browserSpeechEvent(4, 'u-voice'))
    expect(state?.voice).toBe('Google UK English Female')
    expect(state?.rate).toBe(1.2)
    expect(state?.pitch).toBe(0.9)
    expect(talkSpeechProjectionSchema.safeParse(state).success).toBe(true)
    const local = applyTalkSpeechProjection(initTalkSpeechProjection(), speechEvent(5, 'u-local'))!
    expect('voice' in local).toBe(false)
    expect('rate' in local).toBe(false)
    expect('pitch' in local).toBe(false)
  })

  it('validates both the null and value shapes', () => {
    expect(talkSpeechProjectionSchema.safeParse(null).success).toBe(true)
    const value = applyTalkSpeechProjection(initTalkSpeechProjection(), speechEvent(2, 'u-1'))!
    expect(talkSpeechProjectionSchema.safeParse(value).success).toBe(true)
    expect(talkSpeechProjectionSchema.safeParse({ nope: 1 }).success).toBe(false)
    expect(talkSpeechProjectionSchema.safeParse({ ...value, rate: 0.05 }).success).toBe(false)
    expect(talkSpeechProjectionSchema.safeParse({ ...value, pitch: 2.5 }).success).toBe(false)
  })

  it('folds a macOS-engine utterance through the projection', () => {
    const macosEvent = {
      seq: 12,
      type: 'dsh-talk/speech',
      data: {
        kind: 'tts',
        utteranceId: 'u-macos',
        engine: 'macos',
        text: '你好。',
        audioBytes: 4096,
        reason: 'auto-reply',
      },
    } as unknown as SessionEvent
    const state = applyTalkSpeechProjection(initTalkSpeechProjection(), macosEvent)
    expect(state?.engine).toBe('macos')
    expect(talkSpeechProjectionSchema.safeParse(state).success).toBe(true)
  })

  it('folds an ignorable plugin record (0.2.1+ transport) and the auto-reply reason', () => {
    const state = applyTalkSpeechProjection(initTalkSpeechProjection(), pluginRecordEvent(6, 'u-record'))
    expect(state?.utteranceId).toBe('u-record')
    expect(state?.reason).toBe('auto-reply')
    expect(talkSpeechProjectionSchema.safeParse(state).success).toBe(true)
  })

  it('ignores a restored plugin record whose payload is not a valid speech event', () => {
    const state = applyTalkSpeechProjection(initTalkSpeechProjection(), pluginRecordEvent(7, 'u-good'))
    const after = applyTalkSpeechProjection(state, malformedPluginRecordEvent(8))
    expect(after).toBe(state)
  })

  it('carries the log event timestamp so the client can drop stale frames', () => {
    const fresh = speechEvent(11, 'u-timed') as unknown as { time?: number }
    fresh.time = 1_760_000_000_000
    const state = applyTalkSpeechProjection(initTalkSpeechProjection(), fresh as never)
    expect(state?.at).toBe(1_760_000_000_000)
    expect(talkSpeechProjectionSchema.safeParse(state).success).toBe(true)
  })

  it('keeps the pre-existing plugin record when a plain event follows it', () => {
    let state = applyTalkSpeechProjection(initTalkSpeechProjection(), pluginRecordEvent(9, 'u-record'))
    state = applyTalkSpeechProjection(state, speechEvent(10, 'u-plain'))
    expect(state?.utteranceId).toBe('u-plain')
  })
})
