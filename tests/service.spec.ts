/**
 * Service pipeline: engine selection, MiniMax → MLX fallback, manual
 * play-latest, scoped stop, export and status.
 *
 * @module dsh-talk/test/service.spec
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { EngineFailure } from '../src/engine.ts'
import type { TalkService } from '../src/service.ts'
import { appendAssistantMessage, mountHarness, speechEventsOf } from './harness.ts'

interface SynthResult {
  mime: 'audio/mpeg' | 'audio/wav'
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

/** Install a fake MLX engine on the private field (tests only). */
function installMlx(service: TalkService, engine: FakeEngine): void {
  ;(service as unknown as { mlxEngine: FakeEngine }).mlxEngine = engine
}

const okResult = (mime: SynthResult['mime']): SynthResult => ({ mime, data: new Uint8Array([1, 2, 3]), audioSec: 1.5 })

describe('TalkService.speak', () => {
  it('speaks through the configured MiniMax engine and logs the utterance', async () => {
    const harness = await mountHarness({})
    installMinimax(harness.service, { synthesize: async () => okResult('audio/mpeg') })
    const outcome = await harness.service.speak('你好', { reason: 'manual', session: harness.session })
    expect(outcome).toMatchObject({ spoken: true, engine: 'minimax', audioBytes: 3 })
    const events = speechEventsOf(harness.session)
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toMatchObject({ engine: 'minimax', reason: 'manual', audioBytes: 3 })
    await harness.ctx.fiber.dispose()
  })

  it('falls back to MLX when MiniMax fails and a reference WAV is configured', async () => {
    const harness = await mountHarness({ tts: { mlx: { refAudio: '/tmp/ref.wav' } } })
    installMinimax(harness.service, { synthesize: async () => { throw new EngineFailure('minimax: boom', false) } })
    let sawMlx = false
    installMlx(harness.service, {
      synthesize: async () => {
        sawMlx = true
        return okResult('audio/wav')
      },
    })
    const outcome = await harness.service.speak('你好', { reason: 'auto-reply', session: harness.session })
    expect(sawMlx).toBe(true)
    expect(outcome).toMatchObject({ spoken: true, engine: 'mlx' })
    await harness.ctx.fiber.dispose()
  })

  it('does not fall back on an interruption', async () => {
    const harness = await mountHarness({ tts: { mlx: { refAudio: '/tmp/ref.wav' } } })
    installMinimax(harness.service, { synthesize: async () => { throw new EngineFailure('minimax: interrupted', true) } })
    let sawMlx = false
    installMlx(harness.service, { synthesize: async () => { sawMlx = true; return okResult('audio/wav') } })
    const outcome = await harness.service.speak('你好', { reason: 'manual', session: harness.session })
    expect(sawMlx).toBe(false)
    expect(outcome).toMatchObject({ spoken: false, error: 'interrupted' })
    await harness.ctx.fiber.dispose()
  })

  it('writes the export file when tts.export.enabled is on', async () => {
    const harness = await mountHarness({ tts: { export: { enabled: true } } })
    installMinimax(harness.service, { synthesize: async () => okResult('audio/mpeg') })
    const outcome = await harness.service.speak('你好', { reason: 'manual', session: harness.session })
    expect(outcome.audioExport).toBe('file')
    expect(outcome.audioPath).toBeDefined()
    const bytes = await readFile(outcome.audioPath as string)
    expect([...bytes]).toEqual([1, 2, 3])
    await harness.ctx.fiber.dispose()
  })
})

describe('TalkService.playLatest', () => {
  it('reads the newest assistant reply of the session', async () => {
    const harness = await mountHarness({})
    appendAssistantMessage(harness.session, 1, '这是最近一条回复。')
    let spoken = ''
    installMinimax(harness.service, {
      synthesize: async text => {
        spoken = text
        return okResult('audio/mpeg')
      },
    })
    const result = await harness.service.playLatest(String(harness.session.id))
    expect(result.spoken).toBe(true)
    expect(result.engine).toBe('minimax')
    expect(spoken).toContain('最近一条回复')
    await harness.ctx.fiber.dispose()
  })

  it('reports a no-op when no reply exists or the session is unknown', async () => {
    const harness = await mountHarness({})
    await expect(harness.service.playLatest(String(harness.session.id))).resolves.toMatchObject({ spoken: false, engine: null })
    await expect(harness.service.playLatest('missing')).resolves.toMatchObject({ spoken: false, error: 'session not found' })
    await harness.ctx.fiber.dispose()
  })
})

describe('TalkService.stop', () => {
  it('aborts an in-flight synthesis and reports that it stopped', async () => {
    const harness = await mountHarness({})
    let rejectSynth: ((error: Error) => void) | undefined
    installMinimax(harness.service, {
      synthesize: async (_text, signal) => await new Promise<SynthResult>((_resolve, reject) => {
        rejectSynth = reject
        signal.addEventListener('abort', () => reject(new EngineFailure('minimax: interrupted', true)), { once: true })
      }),
    })
    const pending = harness.service.speak('你好', { reason: 'manual', session: harness.session })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(harness.service.status().speaking).toBe(true)
    const stopped = harness.service.interrupt()
    expect(stopped.stopped).toBe(true)
    rejectSynth?.(new EngineFailure('minimax: interrupted', true))
    await expect(pending).resolves.toMatchObject({ spoken: false, error: 'interrupted' })
    expect(harness.service.status().speaking).toBe(false)
    await harness.ctx.fiber.dispose()
  })
})

describe('TalkService.status', () => {
  it('reports the configured engine, voice and effective mode', async () => {
    const harness = await mountHarness({ autoReply: { enabled: false }, tts: { minimax: { voiceId: 'female-yujie' } } })
    expect(harness.service.status()).toEqual({
      engine: 'minimax',
      speaking: false,
      voiceId: 'female-yujie',
      mode: 'manual',
    })
    await harness.ctx.fiber.dispose()
  })
})

describe('TalkService.applyMode', () => {
  it('defaults to auto, flips at runtime and never touches the configured default', async () => {
    const harness = await mountHarness({})
    expect(harness.service.status().mode).toBe('auto')
    expect(harness.service.applyMode('manual')).toEqual({ mode: 'manual' })
    expect(harness.service.status().mode).toBe('manual')
    expect(harness.service.applyMode('auto')).toEqual({ mode: 'auto' })
    expect(harness.service.status().mode).toBe('auto')
    await harness.ctx.fiber.dispose()
  })

  it('keeps manual playback working while the mode is manual', async () => {
    const harness = await mountHarness({ autoReply: { enabled: false } })
    expect(harness.service.mode()).toBe('manual')
    appendAssistantMessage(harness.session, 1, '手动播报的回复。')
    let spoken = ''
    installMinimax(harness.service, {
      synthesize: async text => {
        spoken = text
        return okResult('audio/mpeg')
      },
    })
    await expect(harness.service.playLatest(String(harness.session.id))).resolves.toMatchObject({ spoken: true, engine: 'minimax' })
    expect(spoken).toContain('手动播报的回复')
    await harness.ctx.fiber.dispose()
  })

  it('rejects a mode outside the wire vocabulary and keeps the previous mode', async () => {
    const harness = await mountHarness({})
    expect(() => harness.service.applyMode('sometimes' as never)).toThrow(/mode must be one of/)
    expect(harness.service.status().mode).toBe('auto')
    await harness.ctx.fiber.dispose()
  })
})
