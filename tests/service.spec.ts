/**
 * Service pipeline: MiniMax synthesis, the utterance queue the Web UI drains,
 * manual play-latest, scoped stop, the runtime mode and session resolution.
 *
 * @module dsh-talk/test/service.spec
 */

import { describe, expect, it } from 'vitest'
import { EngineFailure } from '../src/engine.ts'
import type { TalkService } from '../src/service.ts'
import { TALK_INVOCATIONS } from '../src/wire.ts'
import { appendAssistantMessage, mountHarness, speechEventsOf } from './harness.ts'

interface SynthResult {
  mime: 'audio/mpeg'
  data: Uint8Array
  audioSec: number
}

interface FakeEngine {
  synthesize(text: string, signal: AbortSignal): Promise<SynthResult>
}

/** Install a fake MiniMax engine on the private field (tests only). */
function installMinimax(service: TalkService, engine: FakeEngine): void {
  ;(service as unknown as { minimaxEngine: FakeEngine }).minimaxEngine = engine
}

const okResult = (): SynthResult => ({ mime: 'audio/mpeg', data: new Uint8Array([1, 2, 3]), audioSec: 1.5 })

describe('TalkService.speak + pending queue', () => {
  it('synthesizes, logs the utterance and queues the MP3 for the client', async () => {
    const harness = await mountHarness({})
    installMinimax(harness.service, { synthesize: async () => okResult() })
    const outcome = await harness.service.speak('你好', { reason: 'manual', session: harness.session })
    expect(outcome).toMatchObject({ spoken: true, engine: 'minimax', audioBytes: 3 })
    expect(speechEventsOf(harness.session)).toHaveLength(1)

    const pending = harness.service.pending(0)
    expect(pending.items).toHaveLength(1)
    expect(pending.items[0]).toMatchObject({
      sessionId: String(harness.session.id),
      text: '你好',
      mime: 'audio/mpeg',
      audioBase64: Buffer.from([1, 2, 3]).toString('base64'),
      bytes: 3,
    })
    expect(pending.cursor).toBeGreaterThan(0)
    await harness.ctx.fiber.dispose()
  })

  it('returns no audio for a baseline or stale cursor', async () => {
    const harness = await mountHarness({})
    installMinimax(harness.service, { synthesize: async () => okResult() })
    await harness.service.speak('你好', { reason: 'manual', session: harness.session })
    expect(harness.service.pending(-1).items).toEqual([])
    expect(harness.service.pending(999).items).toEqual([])
    await harness.ctx.fiber.dispose()
  })

  it('reports a synthesis failure without queueing anything', async () => {
    const harness = await mountHarness({})
    installMinimax(harness.service, { synthesize: async () => { throw new EngineFailure('minimax: boom', false) } })
    const outcome = await harness.service.speak('你好', { reason: 'manual', session: harness.session })
    expect(outcome).toMatchObject({ spoken: false, engine: 'minimax', error: 'minimax: boom' })
    expect(harness.service.pending(0).items).toEqual([])
    await harness.ctx.fiber.dispose()
  })
})

describe('TalkService.stop', () => {
  it('aborts in-flight synthesis and drops queued utterances', async () => {
    const harness = await mountHarness({})
    installMinimax(harness.service, { synthesize: async () => okResult() })
    await harness.service.speak('先念这句', { reason: 'manual', session: harness.session })
    expect(harness.service.pending(0).items).toHaveLength(1)

    let rejectSynth: ((error: Error) => void) | undefined
    installMinimax(harness.service, {
      synthesize: async (_text, signal) => await new Promise<SynthResult>((_resolve, reject) => {
        rejectSynth = reject
        signal.addEventListener('abort', () => reject(new EngineFailure('minimax: interrupted', true)), { once: true })
      }),
    })
    const pending = harness.service.speak('长文朗读', { reason: 'manual', session: harness.session })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(harness.service.isSpeaking()).toBe(true)
    expect(harness.service.stop()).toEqual({ stopped: true })
    rejectSynth?.(new EngineFailure('minimax: interrupted', true))
    await expect(pending).resolves.toMatchObject({ spoken: false, error: 'interrupted' })
    expect(harness.service.isSpeaking()).toBe(false)
    expect(harness.service.pending(0).items).toEqual([])
    await harness.ctx.fiber.dispose()
  })

  it('reports that nothing was stopped when idle', async () => {
    const harness = await mountHarness({})
    expect(harness.service.stop()).toEqual({ stopped: false })
    await harness.ctx.fiber.dispose()
  })
})

describe('TalkService.playLatest', () => {
  it('synthesizes the newest assistant reply of the session', async () => {
    const harness = await mountHarness({})
    appendAssistantMessage(harness.session, 1, '这是最近一条回复。')
    let spoken = ''
    installMinimax(harness.service, {
      synthesize: async text => {
        spoken = text
        return okResult()
      },
    })
    const result = await harness.service.playLatest(String(harness.session.id))
    expect(result).toMatchObject({ spoken: true, engine: 'minimax' })
    expect(spoken).toContain('最近一条回复')
    expect(harness.service.pending(0).items[0]?.text).toContain('最近一条回复')
    await harness.ctx.fiber.dispose()
  })

  it('falls back to the newest live session when the id is empty', async () => {
    const harness = await mountHarness({})
    appendAssistantMessage(harness.session, 1, '最新一条回复。')
    installMinimax(harness.service, { synthesize: async () => okResult() })
    await expect(harness.service.playLatest('')).resolves.toMatchObject({ spoken: true })
    await harness.ctx.fiber.dispose()
  })

  it('reports a no-op when the session or the reply is missing', async () => {
    const harness = await mountHarness({})
    await expect(harness.service.playLatest(String(harness.session.id))).resolves.toMatchObject({ spoken: false, engine: null })
    await expect(harness.service.playLatest('missing')).resolves.toMatchObject({ spoken: false, error: 'session not found' })
    await harness.ctx.fiber.dispose()
  })
})

describe('TalkService.mode', () => {
  it('defaults from autoReply.enabled and flips at runtime', async () => {
    const harness = await mountHarness({})
    expect(harness.service.status().mode).toBe('auto')
    expect(harness.service.applyMode('manual')).toEqual({ mode: 'manual' })
    expect(harness.service.status().mode).toBe('manual')
    expect(harness.service.applyMode('auto')).toEqual({ mode: 'auto' })
    expect(harness.service.status().mode).toBe('auto')
    await harness.ctx.fiber.dispose()
  })

  it('honours a configured manual default and rejects an unknown mode', async () => {
    const harness = await mountHarness({ autoReply: { enabled: false } })
    expect(harness.service.mode()).toBe('manual')
    expect(() => harness.service.applyMode('sometimes' as never)).toThrow(/mode must be one of/u)
    expect(harness.service.status().mode).toBe('manual')
    await harness.ctx.fiber.dispose()
  })
})

describe('talk Remote descriptors', () => {
  it('names a callable method on the talk service for every invocation', async () => {
    const harness = await mountHarness({})
    for (const descriptor of TALK_INVOCATIONS) {
      const method = (harness.service as unknown as Record<string, unknown>)[descriptor.method]
      expect(typeof method, `talk/${descriptor.method} (${descriptor.id})`).toBe('function')
    }
    await harness.ctx.fiber.dispose()
  })
})
