/**
 * The `speak` tool: MiniMax-only schema, canonical value and render text.
 *
 * @module dsh-talk/test/tool.spec
 */

import { describe, expect, it } from 'vitest'
import { renderSpeak, speakTool } from '../src/tool.ts'
import type { TalkService } from '../src/service.ts'

/** A service double whose speak() answers from a scripted outcome. */
function fakeService(outcome: Record<string, unknown>): TalkService {
  return {
    async speak() {
      return outcome
    },
  } as unknown as TalkService
}

describe('speakTool', () => {
  it('declares only the text parameter and the MiniMax outcome fields', () => {
    const tool = speakTool(fakeService({ spoken: true, engine: 'minimax', audioBytes: 3 }), 100)
    const parameters = tool.parameters as unknown as { properties: Record<string, unknown>; required: readonly string[] }
    expect(Object.keys(parameters.properties)).toEqual(['text'])
    expect(parameters.required).toEqual(['text'])
  })

  it('executes through the service and returns its canonical value', async () => {
    const tool = speakTool(fakeService({ spoken: true, engine: 'minimax', audioBytes: 3, durationSec: 1.5 }), 100)
    const value = await (tool as unknown as { execute: (args: { text: string }, exec: unknown) => Promise<unknown> }).execute(
      { text: 'hello' },
      { signal: new AbortController().signal },
    )
    expect(value).toMatchObject({ spoken: true, engine: 'minimax', audioBytes: 3 })
  })

  it('rejects empty and oversized text', async () => {
    const tool = speakTool(fakeService({ spoken: true }), 5)
    const execute = (tool as unknown as { execute: (args: { text: string }, exec: unknown) => Promise<unknown> }).execute
    await expect(execute({ text: '   ' }, {})).rejects.toThrow(/must not be empty/u)
    await expect(execute({ text: '123456' }, {})).rejects.toThrow(/character cap/u)
  })
})

describe('renderSpeak', () => {
  it('renders a spoken outcome', () => {
    expect(renderSpeak({ text: 'hi' }, { spoken: true, engine: 'minimax', durationSec: 1.25 }))
      .toEqual([{ type: 'text', text: 'Spoke hi aloud with the minimax engine, 1.3s of audio.' }])
  })

  it('renders a failed outcome', () => {
    expect(renderSpeak({ text: 'hi' }, { spoken: false, engine: 'minimax', error: 'minimax: boom' }))
      .toEqual([{ type: 'text', text: 'Speech failed with the minimax engine: minimax: boom.' }])
  })
})
