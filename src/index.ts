/**
 * `dsh-talk` — MiniMax cloud text-to-speech for the Android build of DeepSeek
 * Harness.
 *
 * The `android` branch mounts the `talk` service (MiniMax synthesis, an
 * utterance queue the Web UI drains through `talk/pending`, settings write-back
 * and the runtime auto/manual mode the composer button switches), registers the
 * `speak` tool and the automatic reply read-aloud, and speaks one generic
 * turn-end announcement when a finished turn was not auto-read. Manual mode
 * silences both the auto-read and the announcement.
 *
 * There is no local engine and no host audio player: the Android runtime has
 * neither Apple-silicon MLX nor ffplay, so the WebView plays the queued MP3.
 *
 * Function plugin — no default export (the Loader unwraps
 * `exports.default ?? exports`).
 *
 * @module dsh-talk
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session'
import { AutoReplyController } from './auto-reply.ts'
import { Config, resolveConfig } from './config.ts'
import { TalkService } from './service.ts'
import { speakTool } from './tool.ts'

export const name = 'talk'

/** Hard services: the tool registry. */
export const inject = ['tools']

export { Config, resolveConfig, type AutoReplyConfig, type Config as TalkConfig, type ResolvedConfig } from './config.ts'
export { TalkService, type SpeakOptions, type SpeakOutcome } from './service.ts'
export { speakTool, renderSpeak } from './tool.ts'
export {
  AutoReplyController,
  SPEAK_TOOL_NAME,
  findAutoReply,
  findLatestAssistantText,
  isSubagentSession,
  prepareAutoReplyText,
  stripCodeBlocks,
  truncateAtWhitespace,
  type AutoReplyFinding,
  type AutoReplyPolicy,
  type AutoReplyReason,
  type AutoReplyReply,
  type AutoReplySpeak,
  type AutoReplySpeakOptions,
  type AutoReplyToolSpoke,
} from './auto-reply.ts'
export { EngineFailure } from './engine.ts'
export { sanitizeText, redactSecrets, displayPath } from './sanitize.ts'
export {
  MINIMAX_MAX_AUDIO_BYTES,
  MinimaxEngine,
  minimaxRequestBody,
  parseCredentialRefs,
  parseMinimaxSseLine,
  resolveMinimaxApiKey,
  splitMinimaxText,
} from './minimax.ts'
export { appendSettingsFragment, mergeTalkRowConfig, renderSettingsFragment, validateSettingsInput, yamlScalar } from './settings-patch.ts'
export { appendDiagnostic, describeError, diagnosticsPath, readDiagnostics } from './diagnostics.ts'
export type {
  TalkMode,
  TalkPendingResult,
  TalkPlayResult,
  TalkSettingsInput,
  TalkSettingsResult,
  TalkStatus,
  TalkStopResult,
  TalkUtterance,
} from './wire.ts'
export type { DshTalkSpeechEvent, SpeechReason, SpeechTtsEngine } from './speech.ts'

/**
 * Mount the plugin: the talk service, the speak tool, the auto-reply
 * controller and the turn-end announcement. Every registration is an effect on
 * this fiber, so unload/hot-reload removes them together.
 *
 * @param ctx - context carrying the tool registry.
 * @param config - raw loader config; defaults applied through {@link resolveConfig}.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)

  await ctx.plugin(function mountTalkService(ctx: Context): void {
    new TalkService(ctx, config, resolved, 5)
  })
  if (ctx.fiber.uid === null) return
  const service = ctx.get('talk') as TalkService

  ctx.effect(() => ctx.tools.register(speakTool(service, resolved.maxSpeakChars)), 'dsh-talk: speak tool')

  const autoReply = new AutoReplyController(
    {
      // The composer mode button switches this at runtime: `manual` keeps the
      // controller a no-op without touching the configured default.
      get enabled() {
        return service.mode() === 'auto'
      },
      maxChars: resolved.autoReplyMaxChars,
      skipIfToolSpoke: true,
      skipSubagents: true,
      reasons: ['completed', 'max-tokens'],
    },
    (text, options) => service.speak(text, options),
  )

  const runningAgents = new Set<Agent>()
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') {
      runningAgents.add(agent)
      return
    }
    if (!runningAgents.delete(agent)) return
    // Manual mode never speaks on its own: no auto-read and no turn-end
    // announcement — the composer play button is the only trigger.
    if (service.mode() === 'manual') return
    if (autoReply.handle(agent.session)) return
    if (!resolved.announceEnabled) return
    // Never talk over an in-flight utterance: a long read must play to completion.
    if (service.isSpeaking()) return
    void service.speak('Turn complete.', { reason: 'turn-end', session: agent.session, interrupt: false })
  })
}
