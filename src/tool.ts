/**
 * The `speak` tool: the agent's audible reply channel. Execution hands the
 * text to the talk service, which synthesizes it with MiniMax and queues the
 * audio for the Web UI to play; the audio itself never enters model context.
 * The model only sees the render text, and the utterance lands in the session
 * log as a `dsh-talk/speech` event.
 *
 * @module dsh-talk/tool
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { sanitizeText } from './sanitize.ts'
import type { TalkService } from './service.ts'

/**
 * Render one speak outcome as the model-facing content.
 *
 * @param args - the validated tool arguments.
 * @param value - the canonical outcome.
 * @returns the model content blocks.
 */
export function renderSpeak(args: { text: string }, value: {
  spoken?: boolean
  engine?: string
  audioBytes?: number
  durationSec?: number
  error?: string
  utteranceId?: string
}) {
  if (value.spoken === true) {
    const note = value.error === undefined ? '' : ` (${value.error})`
    const seconds = value.durationSec === undefined ? '' : `, ${value.durationSec.toFixed(1)}s of audio`
    return [{
      type: 'text' as const,
      text: `Spoke ${sanitizeText(args.text, 200)} aloud with the ${value.engine ?? 'unknown'} engine${seconds}.${note}`,
    }]
  }
  return [{
    type: 'text' as const,
    text: `Speech failed with the ${value.engine ?? 'unknown'} engine: ${value.error ?? 'unknown error'}.`,
  }]
}

/**
 * Assemble the `speak` tool definition.
 *
 * @param service - the talk service the execution delegates to.
 * @param maxChars - cap on one spoken text (resolved config).
 * @returns a registry-ready tool.
 */
export function speakTool(service: TalkService, maxChars: number) {
  return defineTool({
    name: 'speak',
    description: 'Speak text aloud to the user on the device (MiniMax cloud voice). Use it for audible replies: the host synthesizes the audio and the chat UI plays it. The session log records what was spoken.',
    parameters: {
      text: {
        type: 'string',
        required: true as const,
        description: 'The exact text to speak aloud.',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          spoken: { type: 'boolean' },
          engine: { type: 'string' },
          audioBytes: { type: 'integer' },
          durationSec: { type: 'number' },
          error: { type: 'string' },
          utteranceId: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: renderSpeak,
    },
    async execute(args, exec) {
      const text = args.text.trim()
      if (text === '') throw new Error('dsh-talk: speak text must not be empty')
      if (text.length > maxChars) throw new Error(`dsh-talk: speak text exceeds the ${maxChars} character cap`)
      const session = exec.agent?.session
      return await service.speak(text, {
        reason: 'speak-tool',
        ...(session === undefined ? {} : { session }),
        signal: exec.signal,
      })
    },
  })
}
