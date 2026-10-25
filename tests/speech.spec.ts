/**
 * The speech append gate: a plain `dsh-talk/speech` append on hosts whose
 * known vocabulary covers the type, an ignorable `plugin:dsh-talk/speech`
 * record on 0.2.1+ hosts that publish `appendPluginRecord`, and a `false`
 * skip on envelope-less hosts. The old source-text probe for an `ignorable`
 * option is gone; this spec pins that no marked or unconditional `Session.append`
 * can come back.
 *
 * @module dsh-talk/test/speech.spec
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, SessionId, type Session } from '@deepseek-ai/dsh-session'
import {
  appendSpeechEvent,
  appendSpeechEventWith,
  SPEECH_EVENT,
  SPEECH_RECORD,
  type DshTalkSpeechEvent,
} from '../src/speech.ts'

const payload: DshTalkSpeechEvent = {
  kind: 'tts',
  utteranceId: 'u-1',
  engine: 'edge-tts',
  text: 'hello',
  audioBytes: 12,
  reason: 'speak-tool',
}

/** A real store + session; the plugin-record branch needs the real Session class. */
async function realSession(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return { ctx, session: ctx.sessions.create(SessionId('dsh-talk-speech')) }
}

/** A minimal session stand-in that records plain `append` calls. */
function fakeSession(calls: unknown[][]): Session {
  const append = function (type: string, data: unknown) {
    calls.push([type, data])
    return {}
  }
  return { append } as unknown as Session
}

describe('appendSpeechEvent — known-vocabulary host', () => {
  it('appends plainly and reports true', () => {
    ;(KNOWN_SESSION_EVENT_TYPES as Set<string>).add(SPEECH_EVENT)
    try {
      const calls: unknown[][] = []
      expect(appendSpeechEvent(fakeSession(calls), payload)).toBe(true)
      expect(calls).toEqual([[SPEECH_EVENT, payload]])
    } finally {
      ;(KNOWN_SESSION_EVENT_TYPES as Set<string>).delete(SPEECH_EVENT)
    }
  })

  it('prefers the plain channel over the plugin-record channel', () => {
    const calls: unknown[][] = []
    const appends: string[] = []
    const appended = appendSpeechEventWith(fakeSession(calls), payload, {
      knownTypes: new Set([SPEECH_EVENT]),
      appendRecord: (_session, type) => {
        appends.push(type)
        return 1
      },
    })
    expect(appended).toBe(true)
    expect(calls).toEqual([[SPEECH_EVENT, payload]])
    expect(appends).toHaveLength(0)
  })
})

describe('appendSpeechEvent — 0.2.1+ host', () => {
  it('appends an ignorable plugin record and reports true', async () => {
    const { session } = await realSession()
    expect(appendSpeechEvent(session, payload)).toBe(true)
    const events = session.snapshotEvents()
    expect(events).toHaveLength(1)
    const record = events[0]!
    expect(record.type).toBe(SPEECH_RECORD)
    expect(record.ignorable).toBe(true)
    expect(record.data).toEqual(payload)
  })

  it('survives a cold load: a session seeded with the plugin record reconstructs it', async () => {
    const { ctx, session } = await realSession()
    expect(appendSpeechEvent(session, payload)).toBe(true)
    const restored = ctx.sessions.create(SessionId('dsh-talk-speech-restored'), { seed: session.snapshotEvents() })
    const record = restored.snapshotEvents().find(event => (event.type as string) === SPEECH_RECORD)
    expect(record).toBeDefined()
    expect(record?.ignorable).toBe(true)
    expect((record?.data as DshTalkSpeechEvent).utteranceId).toBe('u-1')
  })
})

describe('appendSpeechEvent — envelope-less host', () => {
  it('reports false and never appends', () => {
    const calls: unknown[][] = []
    expect(appendSpeechEventWith(fakeSession(calls), payload, { knownTypes: new Set() })).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('reports false on a host with neither channel', () => {
    const calls: unknown[][] = []
    expect(appendSpeechEventWith(fakeSession(calls), payload, {})).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
