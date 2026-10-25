/**
 * Auto-read selection: the finished-turn log scan (reason whitelist, last
 * committed assistant message, speak-tool short circuit), the text preparation
 * (code stripped, capped at a word boundary), and the controller's contract
 * (fire-and-forget speak with reason `auto-reply`, per-session dedupe,
 * subagent skip, handled-vs-not so the caller knows whether to suppress the
 * generic "Turn complete." announcement).
 *
 * The logs are REAL `Session` instances, so every appended event passes the
 * host's own log validation instead of a hand-built fixture; the speak
 * callback is a plain recorder so the fire-and-forget contract is observable.
 *
 * @module dsh-talk/test/auto-reply.spec
 */

import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session, type TurnEndReason } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  AutoReplyController,
  findAutoReply,
  isSubagentSession,
  prepareAutoReplyText,
  stripCodeBlocks,
  truncateAtWhitespace,
  type AutoReplyFinding,
  type AutoReplyPolicy,
  type AutoReplyReply,
  type AutoReplySpeak,
  type AutoReplySpeakOptions,
} from '../src/auto-reply.ts'
import { appendAssistantMessage, appendTurnEnd } from './harness.ts'

let sessionCounter = 0

/** Create a detached real session (own store) for one log scenario. */
async function newSession(meta?: { origin?: 'subagent'; delegationDepth?: number }): Promise<Session> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  sessionCounter += 1
  return ctx.sessions.create(SessionId(`auto-reply-${sessionCounter}`), meta === undefined ? undefined : { meta })
}

/** The resolved default policy, with per-test overrides. */
function policy(overrides: Partial<AutoReplyPolicy> = {}): AutoReplyPolicy {
  return {
    enabled: true,
    maxChars: 600,
    skipIfToolSpoke: true,
    skipSubagents: true,
    reasons: ['completed', 'max-tokens'],
    ...overrides,
  }
}

/** One recorded speak call. */
interface SpeakCall {
  readonly text: string
  readonly options: AutoReplySpeakOptions
}

/** A recording speak callback plus its call log. */
function recordingSpeak(): { speak: AutoReplySpeak; calls: SpeakCall[] } {
  const calls: SpeakCall[] = []
  const speak: AutoReplySpeak = async (text, options) => {
    calls.push({ text, options })
    return { spoken: true }
  }
  return { speak, calls }
}

/** Narrow a finding to the reply variant (a speak-tool short circuit fails the spec). */
function replyOf(finding: AutoReplyFinding | null): AutoReplyReply {
  if (finding === null || 'kind' in finding) throw new Error('expected a reply selection')
  return finding
}

/** Append one assistant `tool/call` event for `turn`. */
function appendToolCall(session: Session, turn: number, name: string, step = 1): void {
  session.append('tool/call', {
    turn,
    step,
    // The ToolCallId brand is type-only; a raw harness id is valid at runtime.
    callId: `call-${session.seq}` as never,
    name,
    arguments: '{}',
  })
}

/** One finished turn with a single assistant reply. */
async function finishedTurn(
  reply: string,
  reason: TurnEndReason = { kind: 'completed' },
  meta?: { origin?: 'subagent'; delegationDepth?: number },
): Promise<{ session: Session; messageId: string }> {
  const session = await newSession(meta)
  session.append('turn/start', { turn: 1 })
  const messageId = appendAssistantMessage(session, 1, reply)
  appendTurnEnd(session, 1, reason)
  return { session, messageId }
}

describe('findAutoReply', () => {
  it('selects the last committed assistant message of a completed turn', async () => {
    const session = await newSession()
    session.append('turn/start', { turn: 1 })
    appendAssistantMessage(session, 1, 'Let me check that first.')
    const finalId = appendAssistantMessage(session, 1, 'The answer is 42.')
    appendTurnEnd(session, 1)
    expect(findAutoReply(session.snapshotEvents(), policy())).toEqual({ turn: 1, messageId: finalId, text: 'The answer is 42.' })
  })

  it('qualifies completed and max-tokens turns and rejects the other end reasons', async () => {
    const { session, messageId } = await finishedTurn('The answer is 42.')
    expect(findAutoReply(session.snapshotEvents(), policy())).toEqual({ turn: 1, messageId, text: 'The answer is 42.' })

    const allowed = await finishedTurn('Cut short but usable.', { kind: 'max-tokens' })
    expect(replyOf(findAutoReply(allowed.session.snapshotEvents(), policy())).text).toBe('Cut short but usable.')

    for (const reason of [
      { kind: 'aborted', reason: { kind: 'legacy' } },
      { kind: 'blocked' },
      { kind: 'error', error: { message: 'provider blew up', code: 'UNKNOWN' } },
      { kind: 'interrupted' },
    ] as const satisfies readonly TurnEndReason[]) {
      const skipped = await finishedTurn('Should not be read aloud.', reason)
      expect(findAutoReply(skipped.session.snapshotEvents(), policy())).toBeNull()
    }
  })

  it('honours a narrowed reason whitelist in both directions', async () => {
    const completed = await finishedTurn('Completed reply.')
    expect(findAutoReply(completed.session.snapshotEvents(), policy({ reasons: ['max-tokens'] }))).toBeNull()

    const maxTokens = await finishedTurn('Truncated reply.', { kind: 'max-tokens' })
    expect(replyOf(findAutoReply(maxTokens.session.snapshotEvents(), policy({ reasons: ['max-tokens'] }))).text).toBe('Truncated reply.')
    expect(findAutoReply(maxTokens.session.snapshotEvents(), policy({ reasons: ['completed'] }))).toBeNull()
  })

  it('returns null while the last turn is still open (no turn/end in the log)', async () => {
    const session = await newSession()
    session.append('turn/start', { turn: 1 })
    appendAssistantMessage(session, 1, 'Not committed yet.')
    expect(findAutoReply(session.snapshotEvents(), policy())).toBeNull()
  })

  it('returns null when the finished turn has no assistant message', async () => {
    const session = await newSession()
    session.append('turn/start', { turn: 1 })
    appendTurnEnd(session, 1)
    expect(findAutoReply(session.snapshotEvents(), policy())).toBeNull()
  })

  it('returns null when the reply carries no speakable prose (code only)', async () => {
    const fenced = await finishedTurn('```js\nconst answer = 42\n```')
    expect(findAutoReply(fenced.session.snapshotEvents(), policy())).toBeNull()
  })

  it('caps the selected text at the policy maxChars', async () => {
    const { session } = await finishedTurn('one two three four five six seven')
    const finding = replyOf(findAutoReply(session.snapshotEvents(), policy({ maxChars: 14 })))
    expect(finding.text).toBe('one two three')
  })

  it('short-circuits to tool-spoke when the turn already called speak', async () => {
    const session = await newSession()
    session.append('turn/start', { turn: 1 })
    appendToolCall(session, 1, 'speak')
    appendAssistantMessage(session, 1, 'Already spoken by the tool.')
    appendTurnEnd(session, 1)
    expect(findAutoReply(session.snapshotEvents(), policy())).toEqual({ kind: 'tool-spoke' })
    // With the guard off the reply is selected again.
    expect(findAutoReply(session.snapshotEvents(), policy({ skipIfToolSpoke: false }))).not.toBeNull()
  })

  it('only looks at the speak tool of the finished turn, not an earlier turn', async () => {
    const session = await newSession()
    session.append('turn/start', { turn: 1 })
    appendToolCall(session, 1, 'speak')
    appendAssistantMessage(session, 1, 'Turn one said its piece.')
    appendTurnEnd(session, 1)
    session.append('turn/start', { turn: 2 })
    appendAssistantMessage(session, 2, 'Turn two is a normal reply.')
    appendTurnEnd(session, 2)
    const finding = replyOf(findAutoReply(session.snapshotEvents(), policy()))
    expect(finding.turn).toBe(2)
    expect(finding.text).toBe('Turn two is a normal reply.')
  })
})

describe('stripCodeBlocks', () => {
  it('drops fenced blocks whole and keeps the surrounding prose', () => {
    expect(stripCodeBlocks('Intro\n```js\nconsole.log("x")\n```\nOutro')).toBe('Intro\n\nOutro')
  })

  it('drops an unterminated fence through the end of the text', () => {
    expect(stripCodeBlocks('Intro\n```js\nstill typing')).toBe('Intro\n')
  })

  it('strips inline backtick delimiters while keeping the code text', () => {
    expect(stripCodeBlocks('Call `speak` twice.')).toBe('Call speak twice.')
  })
})

describe('truncateAtWhitespace', () => {
  it('returns text that already fits unchanged', () => {
    expect(truncateAtWhitespace('short reply', 600)).toBe('short reply')
  })

  it('cuts back to the last word boundary inside the window', () => {
    expect(truncateAtWhitespace('alpha beta gamma', 12)).toBe('alpha beta')
  })

  it('hard-cuts an unbroken token that has no boundary', () => {
    expect(truncateAtWhitespace('abcdefghij', 4)).toBe('abcd')
  })
})

describe('prepareAutoReplyText', () => {
  it('joins text blocks with newlines and ignores non-text blocks', () => {
    expect(prepareAutoReplyText([
      { type: 'text', text: 'First line.' },
      { type: 'reasoning', text: 'hidden chain of thought' },
      { type: 'text', text: 'Second line.' },
    ], 600)).toBe('First line.\nSecond line.')
  })

  it('returns empty text for an empty or code-only message', () => {
    expect(prepareAutoReplyText([], 600)).toBe('')
    expect(prepareAutoReplyText([{ type: 'text', text: '   ' }], 600)).toBe('')
  })
})

describe('isSubagentSession', () => {
  it('classifies by the durable header (origin or delegation depth)', async () => {
    expect(isSubagentSession(await newSession())).toBe(false)
    expect(isSubagentSession(await newSession({ origin: 'subagent' }))).toBe(true)
    expect(isSubagentSession(await newSession({ delegationDepth: 1 }))).toBe(true)
  })
})

describe('AutoReplyController', () => {
  it('speaks the selected reply once with reason auto-reply and reports handled', async () => {
    const { session, messageId } = await finishedTurn('Here is the final answer.')
    const { speak, calls } = recordingSpeak()
    const controller = new AutoReplyController(policy(), speak)

    expect(controller.handle(session)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ text: 'Here is the final answer.' })
    expect(calls[0]?.options.reason).toBe('auto-reply')
    expect(calls[0]?.options.session).toBe(session)
    // Auto-read never preempts in-flight speech: long reads must finish.
    expect(calls[0]?.options.interrupt).toBe(false)
    expect(messageId).toBeDefined()
  })

  it('dedupes a second idle for the same assistant message but still reports handled', async () => {
    const { session } = await finishedTurn('Only read once, please.')
    const { speak, calls } = recordingSpeak()
    const controller = new AutoReplyController(policy(), speak)

    expect(controller.handle(session)).toBe(true)
    expect(controller.handle(session)).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('speaks a new reply after a later turn commits a new message', async () => {
    const session = await newSession()
    const { speak, calls } = recordingSpeak()
    const controller = new AutoReplyController(policy(), speak)

    session.append('turn/start', { turn: 1 })
    appendAssistantMessage(session, 1, 'First reply.')
    appendTurnEnd(session, 1)
    expect(controller.handle(session)).toBe(true)

    session.append('turn/start', { turn: 2 })
    appendAssistantMessage(session, 2, 'Second reply.')
    appendTurnEnd(session, 2)
    expect(controller.handle(session)).toBe(true)

    expect(calls.map(call => call.text)).toEqual(['First reply.', 'Second reply.'])
  })

  it('is a no-op when autoReply.enabled is false (announcement path unchanged)', async () => {
    const { session } = await finishedTurn('Not auto-read.')
    const { speak, calls } = recordingSpeak()
    const controller = new AutoReplyController(policy({ enabled: false }), speak)
    expect(controller.handle(session)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('never speaks for a subagent session and does not claim the turn as handled', async () => {
    for (const meta of [{ origin: 'subagent' as const }, { delegationDepth: 1 }]) {
      const { session } = await finishedTurn('Subagent chatter.', { kind: 'completed' }, meta)
      const { speak, calls } = recordingSpeak()
      const controller = new AutoReplyController(policy(), speak)
      expect(controller.handle(session)).toBe(false)
      expect(calls).toHaveLength(0)
    }
  })

  it('reads a subagent session when skipSubagents is turned off', async () => {
    const { session } = await finishedTurn('Allowed subagent reply.', { kind: 'completed' }, { origin: 'subagent' })
    const { speak, calls } = recordingSpeak()
    const controller = new AutoReplyController(policy({ skipSubagents: false }), speak)
    expect(controller.handle(session)).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('treats a speak-tool turn as handled without speaking', async () => {
    const session = await newSession()
    session.append('turn/start', { turn: 1 })
    appendToolCall(session, 1, 'speak')
    appendAssistantMessage(session, 1, 'Already spoken.')
    appendTurnEnd(session, 1)
    const { speak, calls } = recordingSpeak()
    const controller = new AutoReplyController(policy(), speak)
    expect(controller.handle(session)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('does not claim an open or unreadable turn (announcement fallback)', async () => {
    const open = await newSession()
    open.append('turn/start', { turn: 1 })
    appendAssistantMessage(open, 1, 'Still streaming.')
    const { speak, calls } = recordingSpeak()
    expect(new AutoReplyController(policy(), speak).handle(open)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('swallows a rejected speak instead of throwing into the listener', async () => {
    const { session } = await finishedTurn('The synth will fail.')
    const controller = new AutoReplyController(policy(), () => Promise.reject(new Error('tts exploded')))
    expect(controller.handle(session)).toBe(true)
    // The rejection is consumed by the controller's `.catch`; an unhandled
    // rejection would fail this spec through vitest's unhandled-rejection hook.
    await Promise.resolve()
  })

  it('never throws when the log cannot be read', async () => {
    const { session } = await finishedTurn('Unreadable log.')
    const broken = {
      header: session.header,
      snapshotEvents: () => {
        throw new Error('log read failed')
      },
    } as unknown as Session
    const { speak, calls } = recordingSpeak()
    expect(new AutoReplyController(policy(), speak).handle(broken)).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
