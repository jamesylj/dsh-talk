/**
 * The `speak` tool: the agent's audible reply channel. Execution hands the
 * text to the talk service, which plays it on the host through MiniMax (or the
 * MLX clone fallback); the audio itself never enters model context. The model
 * only sees the render text, and the utterance lands in the session log as a
 * `dsh-talk/speech` event.
 *
 * When `tts.export.enabled` is on, the synthesized audio is also written to the
 * plugin's bounded directory and the absolute path rides the value/render text
 * so the model can hand it to another tool.
 *
 * @module dsh-talk/tool
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { redactSecrets, sanitizeText } from './sanitize.ts'
import type { TalkService } from './service.ts'

/**
 * Render the audio-file clause of one outcome. `displayPath` is deliberately
 * NOT applied: the path is the usable artifact (the model passes it verbatim
 * to another tool) and it still passes `redactSecrets`.
 *
 * @param value - the canonical outcome fields that describe the file.
 * @returns the sentence to append, or an empty string when there is nothing to say.
 */
function renderAudioFile(value: { audioPath?: string; audioExport?: string; exportNote?: string }): string {
  if (value.audioExport === 'file' && value.audioPath !== undefined && value.audioPath !== '') {
    return ` Audio file: ${redactSecrets(value.audioPath)}`
  }
  if (value.audioExport === undefined) return ''
  const note = value.exportNote === undefined || value.exportNote === '' ? value.audioExport : value.exportNote
  return ` No audio file: ${redactSecrets(note)}.`
}

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
  audioPath?: string
  audioExport?: string
  exportNote?: string
}) {
  if (value.spoken === true) {
    const note = value.error === undefined ? '' : ` (${value.error})`
    return [{
      type: 'text' as const,
      text: `Spoke ${sanitizeText(args.text, 200)} aloud with the ${value.engine ?? 'unknown'} engine.${note}${renderAudioFile(value)}`,
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
    description: 'Speak text aloud to the user on the host machine (MiniMax cloud voice by default, local MLX clone fallback). Use it for audible replies. Audio plays on the host as it synthesizes; with tts.export.enabled the file path is returned in audioPath. The session log records what was spoken.',
    parameters: {
      text: {
        type: 'string',
        required: true as const,
        description: 'The exact text to speak aloud.',
      },
      engine: {
        type: 'string',
        enum: ['minimax', 'mlx'],
        description: 'TTS engine override; default is the configured engine.',
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
          audioPath: { type: 'string' },
          audioExport: { type: 'string', enum: ['file', 'disabled', 'failed'] },
          exportNote: { type: 'string' },
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
        ...(args.engine === undefined ? {} : { engine: args.engine }),
        reason: 'speak-tool',
        ...(session === undefined ? {} : { session }),
        signal: exec.signal,
      })
    },
  })
}
