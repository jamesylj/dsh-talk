/**
 * Shared test harness for dsh-talk: REAL Cordis `Context`, REAL
 * `SessionStore`/`Session`/`ToolRuntime`/`SessionProjectionRegistry` from the
 * 0.1.1-rc.2 peers, plus a scripted subprocess provider (a subclass of the
 * REAL `SubprocessRuntime`) and a structurally complete fake agent. The
 * speech engines run through the same command/exit path as production, with
 * stdout/stderr and exit codes scripted per test.
 *
 * @module dsh-talk/test/harness
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import SessionStore, { SessionId, type Session, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import {
  SubprocessRuntime,
  type SubprocessCollectedOutputs,
  type SubprocessHandle,
  type SubprocessOutcome,
  type SubprocessOutputReader,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SPEECH_EVENT } from '../src/speech.ts'
import type { TalkService } from '../src/service.ts'

/** A subprocess provider whose spawns answer from scripted stdout/exit facts. */
export class FakeSubprocessRuntime extends SubprocessRuntime {
  /** Scripted stdout text for the next spawn. */
  nextStdout = ''
  /** Scripted exit code for the next spawn. */
  nextExitCode = 0
  /** Scripted stderr text for the next spawn. */
  nextStderr = ''
  /** When set, a spawn whose argv names an audio output (`--write-media <path>` or `-o <path>`) writes these bytes there (successful local synthesis). */
  nextSynthBytes: string | null = null
  /** Every spawn spec recorded. */
  spawns: SubprocessSpawnSpec[] = []

  constructor(ctx: Context) {
    super(ctx)
  }

  resolveExecutable(command: string): Promise<string> {
    return Promise.resolve(`C:\\Windows\\System32\\${command}`)
  }

  async terminalEnvironment(): Promise<{ platform: 'windows' }> {
    return { platform: 'windows' }
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    let mediaWrite: Promise<void> = Promise.resolve()
    if (this.nextSynthBytes !== null) {
      const markers = ['--write-media', '-o']
      for (const flag of markers) {
        const marker = spec.argv.indexOf(flag)
        if (marker === -1 || marker + 1 >= spec.argv.length) continue
        // `say -v '?'` lists voices and names no output; only an output flag writes bytes.
        mediaWrite = writeFile(spec.argv[marker + 1] as string, this.nextSynthBytes, 'binary')
        break
      }
    }
    const stdout = this.nextStdout
    const stderr = this.nextStderr
    const exitCode = this.nextExitCode
    const readerOf = (text: string): SubprocessOutputReader => ({
      readFrom: fromByte => ({ text: text.slice(fromByte), nextOffset: text.length, lossy: false }),
    })
    const collected: SubprocessCollectedOutputs = {
      stdout: readerOf(stdout),
      stderr: readerOf(stderr),
    }
    const outcome: SubprocessOutcome = { exitCode, signal: null }
    const handle = {
      // A successfully scripted spawn; the newer host line types the tree root
      // pid on the handle, the pinned 0.2.1 peer does not (extra field, harmless).
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected,
      done: mediaWrite.then(() => outcome),
      terminate: () => undefined,
      waitForExit: async () => true,
    }
    return handle
  }

  spawnTerminal(): never {
    throw new Error('not used by tests')
  }
}

/** Build a structurally complete fake agent over a real session. */
export function makeAgent(session: Session): Agent {
  const fake = {
    id: session.id,
    options: {},
    session,
    inbox: {},
    status: 'idle',
    ctx: new Context(),
    cancel: () => undefined,
    whenIdle: async () => undefined,
    runMaintenance: async (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal),
    send: () => undefined,
    followup: () => undefined,
    steer: () => undefined,
    inject: () => undefined,
  }
  return fake as unknown as Agent
}

/** Everything a mounted harness hands back to a test. */
export interface Harness {
  readonly ctx: Context
  readonly session: Session
  readonly agent: Agent
  readonly subprocess: FakeSubprocessRuntime
  /** The mounted talk service (for assertions about the speech-log outcome table). */
  readonly service: TalkService
  /** The audio-export directory this mount writes into (a per-mount temp dir unless the test set one). */
  readonly exportDir: string
}

/**
 * Point one mount's audio export at a per-mount temp directory. Synthesis in a
 * test would otherwise write into the developer's home directory
 * (`<home>/.dsh-talk/audio` is the production default); a test that sets
 * `tts.export.dir` itself keeps its own value. `tests/global-setup.ts` removes
 * the directories one run created when that run ends.
 *
 * @param config - the raw plugin config the test passed.
 * @returns the config with `tts.export.dir` filled, plus the directory used.
 */
function withTemporaryExportDir(config: Record<string, unknown>): { config: Record<string, unknown>; exportDir: string } {
  const tts = (config['tts'] ?? {}) as Record<string, unknown>
  const exportConfig = (tts['export'] ?? {}) as Record<string, unknown>
  const configured = exportConfig['dir']
  const exportDir = typeof configured === 'string' && configured !== '' ? configured : mkdtempSync(join(tmpdir(), 'dsh-talk-export-'))
  return {
    config: { ...config, tts: { ...tts, export: { ...exportConfig, dir: exportDir } } },
    exportDir,
  }
}

/**
 * Run `body` with `dsh-talk/speech` deliberately marked as a known host
 * vocabulary entry, restoring the previous state afterwards. Legacy hosts
 * appended the plain event; the installed 0.2.1 peer instead publishes the
 * `appendPluginRecord` API, so the default channel is the ignorable
 * `plugin:dsh-talk/speech` record and this helper opts a spec into the plain
 * `dsh-talk/speech` vocabulary branch.
 * @param body - the assertions to run with the vocabulary known.
 */
export async function withKnownSpeechVocabulary(body: () => Promise<void> | void): Promise<void> {
  const known = KNOWN_SESSION_EVENT_TYPES as Set<string>
  const had = known.has(SPEECH_EVENT)
  known.add(SPEECH_EVENT)
  try {
    await body()
  } finally {
    if (!had) known.delete(SPEECH_EVENT)
  }
}

/** Every session-log event type that can carry one speech payload. */
export const SPEECH_EVENT_TYPES = ['dsh-talk/speech', 'plugin:dsh-talk/speech'] as const

/**
 * Collect every speech-bearing event of one session, whichever channel the
 * host carries: the plain `dsh-talk/speech` event on a legacy vocabulary host
 * (or under {@link withKnownSpeechVocabulary}), or the ignorable
 * `plugin:dsh-talk/speech` record the 0.2.1+ API publishes by default.
 *
 * @param session - the session to scan.
 * @returns the speech events in log order (empty when none was carried).
 */
export function speechEventsOf(session: Session): SessionEvent[] {
  return session.snapshotEvents().filter(event => (SPEECH_EVENT_TYPES as readonly string[]).includes(String(event.type)))
}

/**
 * Append one committed assistant message with a single `text` block — the
 * auto-read input the agent loop writes for a completed step.
 *
 * @param session - the session to append to.
 * @param turn - the turn the message belongs to.
 * @param text - the model's reply text.
 * @param options - optional stable message id (the auto-read dedupe key) and step number.
 * @returns the assistant message id that went into the log.
 */
export function appendAssistantMessage(
  session: Session,
  turn: number,
  text: string,
  options: { messageId?: string; step?: number } = {},
): string {
  const messageId = options.messageId ?? `assistant-${session.seq}`
  const data = {
    turn,
    step: options.step ?? 1,
    message: {
      // The MessageId brand is type-only; a raw harness id is valid at runtime.
      id: messageId as never,
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'harness', model: 'harness' },
    },
    // `stream` is required by the 0.2.1 event contract and absent from the
    // older type face; the runtime accepts either, so the dual-typecheck build
    // appends the 0.2.1 shape through a widened payload.
    stream: [],
  }
  session.append('assistant/message', data as never, { surfaceOp: 'append' })
  return messageId
}

/**
 * Close one turn with the given end reason (default `completed`). The agent
 * loop commits this before the running → idle phase change, which is exactly
 * what the auto-read controller scans for.
 *
 * @param session - the session to append to.
 * @param turn - the turn to close.
 * @param reason - the end reason; defaults to `{ kind: "completed" }`.
 */
export function appendTurnEnd(session: Session, turn: number, reason: TurnEndReason = { kind: 'completed' }): void {
  session.append('turn/end', { turn, reason })
}

/**
 * Mount real session/tools/projection services, the scripted subprocess, and
 * this plugin; open one turn so agent-scoped flows work.
 *
 * @param config - raw plugin config.
 * @returns the mounted harness.
 */
export async function mountHarness(config: Record<string, unknown> = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  // The installed 0.2.1 peer does not know the out-of-repo event type, so the
  // gate appends every utterance as an ignorable `plugin:dsh-talk/speech`
  // record instead (see `src/speech.ts`); integration specs collect both
  // channels through `speechEventsOf`, and a spec about the plain-vocabulary
  // branch opts in through `withKnownSpeechVocabulary`.
  const session = ctx.sessions.create(SessionId('dsh-talk-harness'))
  session.append('turn/start', { turn: 1 })
  ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined } as never)
  await ctx.plugin(ToolRuntime)
  // Direct construction binds the registry's own `session/event` listener to
  // THIS context; `ctx.plugin()` would mount it on a child scope whose
  // listener never sees root-emitted session events (production resolves the
  // service at composition level).
  new SessionProjectionRegistry(ctx)
  // `SubprocessRuntime` is a Cordis Service: construction self-registers.
  new FakeSubprocessRuntime(ctx)

  const plugin = await import('../src/index.ts')
  const scoped = withTemporaryExportDir(config)
  await ctx.plugin(plugin as unknown as import('@deepseek-ai/cordis').Plugin, scoped.config)

  const subprocess = ctx.get('subprocess') as unknown as FakeSubprocessRuntime
  const agent = makeAgent(session)
  const service = ctx.get('talk') as unknown as TalkService
  return { ctx, session, agent, subprocess, service, exportDir: scoped.exportDir }
}

/** Re-exported for specs that script subprocess outcomes directly. */
export { SessionId }
