/**
 * Speech session-log seat: the plugin-record channel and the legacy plain
 * event channel carry the same payload.
 *
 * @module dsh-talk/test/speech.spec
 */

import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { appendSpeechEvent, SPEECH_EVENT, type DshTalkSpeechEvent } from '../src/speech.ts'
import { speechEventsOf, withKnownSpeechVocabulary } from './harness.ts'

const payload: DshTalkSpeechEvent = {
  kind: 'tts',
  utteranceId: 'utterance-1',
  engine: 'minimax',
  text: '你好',
  audioBytes: 12,
  reason: 'manual',
}

async function makeSession() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return { ctx, session: ctx.sessions.create(SessionId('dsh-talk-speech-test')) }
}

describe('appendSpeechEvent', () => {
  it('appends a plugin record on hosts that publish appendPluginRecord', async () => {
    const { session } = await makeSession()
    expect(appendSpeechEvent(session, payload)).toBe(true)
    const events = speechEventsOf(session)
    expect(events).toHaveLength(1)
    expect(String(events[0]?.type)).toBe('plugin:dsh-talk/speech')
    expect(events[0]?.data).toMatchObject({ engine: 'minimax', reason: 'manual' })
  })

  it('appends the plain event on a legacy vocabulary host', async () => {
    const { session } = await makeSession()
    await withKnownSpeechVocabulary(async () => {
      expect(appendSpeechEvent(session, payload)).toBe(true)
    })
    const events = speechEventsOf(session)
    expect(events).toHaveLength(1)
    expect(String(events[0]?.type)).toBe(SPEECH_EVENT)
  })
})
