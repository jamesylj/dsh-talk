/**
 * The mic-button state machine: press → recording → transcribing → done,
 * failures, and the elapsed-seconds cap.
 *
 * @module dsh-talk/test/present.spec
 */

import { describe, expect, it } from 'vitest'
import {
  claimUtteranceStart,
  clampRecordSeconds,
  foldMic,
  initMic,
  MAX_TRACKED_UTTERANCES,
  playbackStalled,
  PLAYBACK_STALL_MS,
  resetUtteranceStarts,
} from '../src/client/present.ts'

describe('foldMic', () => {
  it('walks the happy path', () => {
    let state = initMic()
    state = foldMic(state, { kind: 'press', maxSeconds: 60 })
    expect(state.phase).toBe('recording')
    state = foldMic(state, { kind: 'tick', elapsedSec: 3, maxSeconds: 60 })
    expect(state.elapsedSec).toBe(3)
    state = foldMic(state, { kind: 'stopped' })
    expect(state.phase).toBe('transcribing')
    state = foldMic(state, { kind: 'transcribed', text: '  hello world  ' })
    expect(state.phase).toBe('idle')
    expect(state.lastText).toBe('hello world')
  })

  it('records a failure and recovers on reset', () => {
    let state = initMic()
    state = foldMic(state, { kind: 'failed', message: 'mic denied' })
    expect(state.phase).toBe('error')
    expect(state.error).toBe('mic denied')
    state = foldMic(state, { kind: 'reset' })
    expect(state.phase).toBe('idle')
    expect(state.error).toBeUndefined()
  })

  it('caps the elapsed seconds', () => {
    let state = foldMic(initMic(), { kind: 'press', maxSeconds: 30 })
    state = foldMic(state, { kind: 'tick', elapsedSec: 120, maxSeconds: 30 })
    expect(state.elapsedSec).toBe(30)
  })
})

describe('clampRecordSeconds', () => {
  it('clamps to the floor and ceiling', () => {
    expect(clampRecordSeconds(0, 60)).toBe(60)
    expect(clampRecordSeconds(9999, 60)).toBe(600)
    expect(clampRecordSeconds(45.9, 60)).toBe(45)
    expect(clampRecordSeconds(Number.NaN, 60)).toBe(60)
  })
})

describe('claimUtteranceStart', () => {
  it('claims one projection frame exactly once per client runtime', () => {
    resetUtteranceStarts()
    expect(claimUtteranceStart('utterance-a')).toBe(true)
    // A remount, reconnect, or baseline re-delivery of the SAME frame must not
    // speak again.
    expect(claimUtteranceStart('utterance-a')).toBe(false)
    expect(claimUtteranceStart('utterance-b')).toBe(true)
    resetUtteranceStarts()
  })

  it('rejects an empty id instead of claiming it', () => {
    resetUtteranceStarts()
    expect(claimUtteranceStart('')).toBe(false)
  })

  it('bounds memory by evicting the oldest claim', () => {
    resetUtteranceStarts()
    for (let index = 0; index <= MAX_TRACKED_UTTERANCES; index += 1) {
      expect(claimUtteranceStart(`u-${String(index)}`)).toBe(true)
    }
    // Claiming past the bound evicted the oldest claim, so its frame can be
    // claimed again; the newest still cannot.
    expect(claimUtteranceStart('u-0')).toBe(true)
    expect(claimUtteranceStart(`u-${String(MAX_TRACKED_UTTERANCES)}`)).toBe(false)
    resetUtteranceStarts()
  })
})

describe('playbackStalled', () => {
  it('does not flag progress inside the window or an ended element', () => {
    expect(playbackStalled(1_000, 0, false)).toBe(false)
    expect(playbackStalled(PLAYBACK_STALL_MS + 1, 0, true)).toBe(false)
  })

  it('flags an element that stopped advancing without ending', () => {
    expect(playbackStalled(PLAYBACK_STALL_MS + 1, 0, false)).toBe(true)
    expect(playbackStalled(PLAYBACK_STALL_MS * 2, 0, false)).toBe(true)
  })
})
