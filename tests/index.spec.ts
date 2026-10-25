/**
 * Plugin assembly: the apply body registers the speak tool and the
 * talk:speech projection, the approval announcement listener always calls
 * next() (waterfall discipline), and the turn-end listener fires only after an
 * observed running → idle transition — reading the just-finished turn's final
 * reply aloud when auto-read selects one (suppressing the generic
 * announcement), and falling back to that announcement otherwise.
 *
 * @module dsh-talk/test/index.spec
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { appendAssistantMessage, appendTurnEnd, makeAgent, mountHarness, speechEventsOf } from './harness.ts'

/** Read one speech event's payload for assertions (plain event or plugin record). */
function speechPayloadOf(event: SessionEvent | undefined): { reason?: string; text?: string; engine?: string } {
  return (event?.data ?? {}) as { reason?: string; text?: string; engine?: string }
}

describe('apply — assembly', () => {
  it('registers the speak tool and the projection unit', async () => {
    const harness = await mountHarness()
    expect(harness.ctx.tools.get('speak')).toBeDefined()
    const projections = harness.ctx.get('sessionProjections') as { snapshot?: unknown }
    expect(projections).toBeDefined()
  })

  it('emits talk:speech on the registry change feed when a speech event lands', async () => {
    const harness = await mountHarness()
    const projections = harness.ctx.get('sessionProjections') as {
      onChanged(listener: (session: unknown, key: string, value: unknown, seq: number) => void): () => void
    }
    const seen: Array<{ key: string; value: { utteranceId: string } | null; seq: number }> = []
    projections.onChanged((_session, key, value, seq) => { seen.push({ key, value: value as { utteranceId: string } | null, seq }) })
    harness.session.append('dsh-talk/speech', {
      kind: 'tts',
      utteranceId: 'u-wire',
      engine: 'browser',
      text: 'wire check',
      audioBytes: 0,
      reason: 'speak-tool',
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    const frame = seen.find(entry => entry.key === 'talk:speech')
    expect(frame).toBeDefined()
    expect(frame?.value?.utteranceId).toBe('u-wire')
  })

  it('approval/request announces without blocking and always delegates', async () => {
    const harness = await mountHarness({ announce: { onApproval: true } })
    let nextRan = false
    const outcome = await harness.ctx.waterfall(
      'approval/request',
      { agent: harness.agent } as never,
      () => {
        nextRan = true
        return Promise.resolve('rejected' as const)
      },
    )
    expect(nextRan).toBe(true)
    expect(outcome).toBe('rejected')
    // The announcement is fire-and-forget speech; give the pipeline a beat.
    await new Promise(resolve => setTimeout(resolve, 50))
    // The installed 0.2.1 host cannot carry the out-of-repo event type, so the
    // gate appends the utterance as an ignorable plugin record instead — the
    // default channel, not a skip.
    const speech = speechEventsOf(harness.session)
    expect(speech).toHaveLength(1)
    expect(speech[0]?.type).toBe('plugin:dsh-talk/speech')
    expect(speechPayloadOf(speech[0])).toMatchObject({ reason: 'approval' })
    expect(harness.service.speechLogOutcome(String(harness.session.id))).toMatchObject({ appended: 1, skipped: 0 })
  })

  it('announces turn completion after a running → idle transition', async () => {
    const harness = await mountHarness({ tts: { engine: 'browser' } })
    const agent = makeAgent(harness.session)
    harness.ctx.emit('agent/status', { agent, status: 'running' })
    harness.ctx.emit('agent/status', { agent, status: 'idle' })
    // The harness turn is still open (turn/start only), so auto-read selects
    // nothing and the existing announcement path runs — as a plugin record on
    // this host line.
    const speech = speechEventsOf(harness.session)
    expect(speech).toHaveLength(1)
    expect(speech[0]?.type).toBe('plugin:dsh-talk/speech')
    expect(speechPayloadOf(speech[0])).toMatchObject({ reason: 'turn-end', text: 'Turn complete.' })
    expect(harness.service.speechLogOutcome(String(harness.session.id))).toMatchObject({ appended: 1, skipped: 0 })
  })

  it('auto-reads the final reply on running → idle and suppresses the turn-end announcement', async () => {
    const harness = await mountHarness({ tts: { engine: 'browser' } })
    appendAssistantMessage(harness.session, 1, 'The deploy finished cleanly.')
    appendTurnEnd(harness.session, 1)
    harness.ctx.emit('agent/status', { agent: harness.agent, status: 'running' })
    harness.ctx.emit('agent/status', { agent: harness.agent, status: 'idle' })
    const speech = speechEventsOf(harness.session)
    // Exactly one utterance: the reply itself, never "Turn complete." after it.
    expect(speech).toHaveLength(1)
    expect(speechPayloadOf(speech[0])).toMatchObject({
      reason: 'auto-reply',
      text: 'The deploy finished cleanly.',
      engine: 'browser',
    })
  })

  it('falls back to the turn-end announcement when the finished turn is not readable', async () => {
    const harness = await mountHarness({ tts: { engine: 'browser' } })
    appendAssistantMessage(harness.session, 1, 'A reply whose turn was aborted.')
    appendTurnEnd(harness.session, 1, { kind: 'aborted', reason: { kind: 'legacy' } })
    harness.ctx.emit('agent/status', { agent: harness.agent, status: 'running' })
    harness.ctx.emit('agent/status', { agent: harness.agent, status: 'idle' })
    const speech = speechEventsOf(harness.session)
    expect(speech).toHaveLength(1)
    expect(speechPayloadOf(speech[0])).toMatchObject({ reason: 'turn-end', text: 'Turn complete.' })
  })

  it('keeps the turn-end announcement when autoReply.enabled is false', async () => {
    const harness = await mountHarness({ tts: { engine: 'browser' }, autoReply: { enabled: false } })
    appendAssistantMessage(harness.session, 1, 'This reply must not be read.')
    appendTurnEnd(harness.session, 1)
    harness.ctx.emit('agent/status', { agent: harness.agent, status: 'running' })
    harness.ctx.emit('agent/status', { agent: harness.agent, status: 'idle' })
    const speech = speechEventsOf(harness.session)
    expect(speech).toHaveLength(1)
    expect(speechPayloadOf(speech[0])).toMatchObject({ reason: 'turn-end', text: 'Turn complete.' })
  })

  it('reads one reply at most once across repeated running → idle transitions', async () => {
    const harness = await mountHarness({ tts: { engine: 'browser' } })
    appendAssistantMessage(harness.session, 1, 'Read me exactly once.')
    appendTurnEnd(harness.session, 1)
    for (let cycle = 0; cycle < 2; cycle += 1) {
      harness.ctx.emit('agent/status', { agent: harness.agent, status: 'running' })
      harness.ctx.emit('agent/status', { agent: harness.agent, status: 'idle' })
    }
    const speech = speechEventsOf(harness.session)
    expect(speech).toHaveLength(1)
    expect(speechPayloadOf(speech[0])).toMatchObject({ reason: 'auto-reply', text: 'Read me exactly once.' })
  })

  it('stays silent for an idle observation without a prior running', async () => {
    const harness = await mountHarness()
    const before = speechEventsOf(harness.session).length
    harness.ctx.emit('agent/status', { agent: makeAgent(harness.session), status: 'idle' })
    const after = speechEventsOf(harness.session).length
    expect(after).toBe(before)
  })

  it('applies defaults through the loader-style empty config', async () => {
    const harness = await mountHarness({})
    expect(harness.ctx.get('talk')).toBeDefined()
  })
})

describe('apply — fail loud', () => {
  it('resolveConfig throws when the row selects piper without a model', async () => {
    const { resolveConfig } = await import('../src/config.ts')
    expect(() => resolveConfig({ tts: { engine: 'piper' } })).toThrow(/piper/u)
  })

  it('resolveConfig throws when funasr is selected without an endpoint', async () => {
    const { resolveConfig } = await import('../src/config.ts')
    expect(() => resolveConfig({ stt: { engine: 'funasr' } })).toThrow(/funasr/u)
  })
})
