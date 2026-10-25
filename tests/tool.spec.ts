/**
 * The `speak` tool: schema, canonical value (host playback, export state) and
 * the rendered model text.
 *
 * @module dsh-talk/test/tool.spec
 */

import { describe, expect, it } from 'vitest'
import { mountHarness } from './harness.ts'

describe('speak tool', () => {
  it('keeps the model schema, canonical value and content blocks stable', async () => {
    const harness = await mountHarness({})
    try {
      ;(harness.service as unknown as { minimaxEngine: unknown }).minimaxEngine = {
        synthesize: async () => ({ mime: 'audio/mpeg', data: new Uint8Array([1, 2, 3]), audioSec: 2 }),
      }
      const schema = harness.ctx.tools.schemas().find(entry => entry.name === 'speak')
      expect(schema).toBeDefined()
      expect(schema!.parameters).toMatchObject({
        type: 'object',
        properties: {
          text: { type: 'string' },
          engine: { type: 'string', enum: ['minimax', 'mlx'] },
        },
      })
      expect(schema!.parameters.required).toContain('text')

      const result = await harness.ctx.tools.execute({
        callId: 'dsh-talk-speak-tool' as unknown as Parameters<typeof harness.ctx.tools.execute>[0]['callId'],
        name: 'speak',
        arguments: { text: 'hello' },
        agent: harness.agent,
        signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      expect(result.value).toMatchObject({ spoken: true, engine: 'minimax', audioBytes: 3, audioExport: 'disabled' })
      expect(result.content).toEqual([{
        type: 'text',
        text: 'Spoke hello aloud with the minimax engine. No audio file: audio file export is disabled (tts.export.enabled = false).',
      }])
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })

  it('reports a failed synthesis instead of throwing', async () => {
    const harness = await mountHarness({})
    try {
      ;(harness.service as unknown as { minimaxEngine: unknown }).minimaxEngine = {
        synthesize: async () => {
          const { EngineFailure } = await import('../src/engine.ts')
          throw new EngineFailure('minimax: boom', false)
        },
      }
      const result = await harness.ctx.tools.execute({
        callId: 'dsh-talk-speak-fail' as unknown as Parameters<typeof harness.ctx.tools.execute>[0]['callId'],
        name: 'speak',
        arguments: { text: 'hello' },
        agent: harness.agent,
        signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      expect(result.value).toMatchObject({ spoken: false, error: 'minimax: boom' })
      expect(result.content).toEqual([{ type: 'text', text: 'Speech failed with the minimax engine: minimax: boom.' }])
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })
})
