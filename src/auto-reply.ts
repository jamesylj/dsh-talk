/**
 * Default auto-read of the assistant's final reply. The trigger is the existing
 * `agent/status` running → idle transition (NOT `session/event`: dsh-session
 * dispatches that ancestor-only, while `agent/status` is a real Cordis
 * broadcast, and the agent loop commits `turn/end` before `kick()`'s finally
 * sets the phase idle — so the whole turn is already in the log at idle).
 *
 * One scan of the committed session log answers three questions: which turn
 * just ended and why, whether that turn already spoke through the `speak` tool,
 * and what text the assistant finally replied. Only the LAST committed
 * `assistant/message` of the turn is a candidate (never a streaming delta, and
 * never an earlier tool-call preamble step), so an approval/error/aborted turn
 * simply does not qualify. The selected text is spoken through the talk service
 * with reason `auto-reply`, and the controller reports the turn as handled so
 * the caller suppresses the generic "Turn complete." announcement — reading the
 * reply IS the turn-end notification.
 *
 * Pure selection helpers ({@link findAutoReply}, {@link stripCodeBlocks},
 * {@link truncateAtWhitespace}) are separate from the stateful controller
 * ({@link AutoReplyController}, whose per-session dedupe WeakMap survives for
 * the session's lifetime), so the log rules are testable without a mount.
 *
 * @module dsh-talk/auto-reply
 */

import type { Session, SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session'
import type { AutoReplyReason } from './config.ts'

/** The registered `speak` tool name: a call in the turn means the turn spoke already. */
export const SPEAK_TOOL_NAME = 'speak'

/** One assistant message's exact model-facing content blocks. */
type AssistantContent = SessionEvent<'assistant/message'>['data']['message']['content']

/** The auto-read policy resolved from config (see `ResolvedConfig`). */
export interface AutoReplyPolicy {
  /** Master switch: false makes the controller a no-op. */
  readonly enabled: boolean
  /** Cap on the spoken text in characters. */
  readonly maxChars: number
  /** A turn that already called the speak tool is handled without a second utterance. */
  readonly skipIfToolSpoke: boolean
  /** Subagent/delegated sessions never auto-read. */
  readonly skipSubagents: boolean
  /** Turn-end reasons that trigger auto-read. */
  readonly reasons: readonly AutoReplyReason[]
}

/** The final reply selected for reading. */
export interface AutoReplyReply {
  /** The finished turn the reply belongs to. */
  readonly turn: number
  /** Stable assistant message id the per-session dedupe is keyed on. */
  readonly messageId: string
  /** Prepared utterance text (code stripped, capped at `maxChars`). */
  readonly text: string
}

/** The finished turn already spoke through the `speak` tool: handled, nothing to read. */
export interface AutoReplyToolSpoke {
  /** Discriminant: the turn was handled without a new utterance. */
  readonly kind: 'tool-spoke'
}

/** Result of one finished-turn scan: a reply, a speak-tool short-circuit, or nothing. */
export type AutoReplyFinding = AutoReplyReply | AutoReplyToolSpoke

/** Options the controller passes to its speak callback. */
export interface AutoReplySpeakOptions {
  /** Always `auto-reply` (the speech vocabulary reason). */
  readonly reason: 'auto-reply'
  /** Session the utterance is logged to. */
  readonly session: Session
}

/** Speak callback: `TalkService.speak` in production, a spy in tests. */
export type AutoReplySpeak = (text: string, options: AutoReplySpeakOptions) => Promise<unknown>

/** Narrow one event to a known typed variant without casts. */
function isEventOfType<T extends SessionEventType>(event: SessionEvent, type: T): event is SessionEvent<T> {
  return event.type === type
}

/**
 * Read a `turn/end` reason's `kind` defensively. Live turns always carry the
 * structured `{ kind }`; a restored historical log can carry a bare string, and
 * anything unreadable must simply not select a reply (fail calm, not loud).
 *
 * @param reason - the raw `turn/end.data.reason`.
 * @returns the reason kind, or `undefined` when the value is unusable.
 */
function reasonKindOf(reason: unknown): string | undefined {
  if (typeof reason === 'string') return reason
  if (reason === null || typeof reason !== 'object' || !('kind' in reason)) return undefined
  const kind = (reason as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : undefined
}

/**
 * The index of the last event of one type in the log.
 *
 * @param events - a chronological event snapshot.
 * @param type - the event type to find.
 * @returns the index, or -1 when the log has no such event.
 */
function lastIndexOfType(events: readonly SessionEvent[], type: SessionEventType): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === type) return index
  }
  return -1
}

/**
 * The index of the `turn/start` opening `turn`, searching back from the turn's
 * close. A fork-inherited log can start inside a turn and carry no opener, in
 * which case the whole log is the window (-1).
 *
 * @param events - a chronological event snapshot.
 * @param endIndex - index of the closing `turn/end`.
 * @param turn - the turn number.
 * @returns the opener index, or -1 for "start of log".
 */
function turnStartIndexOf(events: readonly SessionEvent[], endIndex: number, turn: number): number {
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event !== undefined && isEventOfType(event, 'turn/start') && event.data.turn === turn) return index
  }
  return -1
}

/**
 * Whether one turn contains a `speak` tool call.
 *
 * @param events - a chronological event snapshot.
 * @param startIndex - index of the turn opener (or -1 for the log start).
 * @param endIndex - index of the closing `turn/end` (exclusive window end).
 * @param turn - the turn number.
 * @returns true when the turn already spoke through the tool.
 */
function hasSpeakToolCall(events: readonly SessionEvent[], startIndex: number, endIndex: number, turn: number): boolean {
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const event = events[index]
    if (
      event !== undefined
      && isEventOfType(event, 'tool/call')
      && event.data.turn === turn
      && event.data.name === SPEAK_TOOL_NAME
    ) {
      return true
    }
  }
  return false
}

/**
 * The last committed assistant message of one turn (the final reply, after any
 * tool-call preamble steps).
 *
 * @param events - a chronological event snapshot.
 * @param startIndex - index of the turn opener (or -1 for the log start).
 * @param endIndex - index of the closing `turn/end` (exclusive window end).
 * @param turn - the turn number.
 * @returns the last assistant message event of the turn, or undefined.
 */
function lastAssistantMessageOf(
  events: readonly SessionEvent[],
  startIndex: number,
  endIndex: number,
  turn: number,
): SessionEvent<'assistant/message'> | undefined {
  for (let index = endIndex - 1; index > startIndex; index -= 1) {
    const event = events[index]
    if (event !== undefined && isEventOfType(event, 'assistant/message') && event.data.turn === turn) return event
  }
  return undefined
}

/** Closed fenced code block, fences and body included. */
const CLOSED_FENCE = /```[\s\S]*?```/gu

/** An unclosed fence: everything from the opening fence to the end of the text. */
const OPEN_FENCE = /```[\s\S]*$/u

/**
 * Remove code from text so it is not read aloud: fenced blocks are dropped
 * whole (their content is not prose), an unterminated fence is dropped through
 * the end, and inline backtick delimiters are stripped while their text stays.
 *
 * @param text - raw assembled reply text.
 * @returns the code-free text (possibly empty).
 */
export function stripCodeBlocks(text: string): string {
  return text.replace(CLOSED_FENCE, '').replace(OPEN_FENCE, '').replace(/`/gu, '')
}

/**
 * Cap text at `maxChars`, backing up to the last word boundary inside the
 * window so a word is never cut in half. An unbroken first token is hard-cut
 * (there is no boundary to prefer), and text that already fits is returned
 * unchanged.
 *
 * @param text - text to cap (already trimmed).
 * @param maxChars - positive character cap.
 * @returns the capped text.
 */
export function truncateAtWhitespace(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const window = text.slice(0, maxChars)
  const cut = window.replace(/\s+\S*$/u, '').trimEnd()
  return cut === '' ? window : cut
}

/**
 * Turn one assistant message's content blocks into speakable text: concatenate
 * the `text` blocks with newlines, strip code, trim, then cap.
 *
 * @param content - the message's model-facing content blocks.
 * @param maxChars - positive character cap.
 * @returns the prepared text, or `''` when the message has no speakable text.
 */
export function prepareAutoReplyText(content: AssistantContent, maxChars: number): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
  }
  const stripped = stripCodeBlocks(parts.join('\n')).trim()
  if (stripped === '') return ''
  return truncateAtWhitespace(stripped, maxChars)
}

/**
 * Whether a session belongs to a subagent/delegated agent. Subagent chatter is
 * never auto-read by default: the header is the durable classification, and
 * delegation depth is the recursion signal (absent means top level).
 *
 * @param session - the session to classify.
 * @returns true for a subagent child or any delegated depth.
 */
export function isSubagentSession(session: Pick<Session, 'header'>): boolean {
  return session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0
}

/**
 * Select the final reply of the last finished turn from a committed event log.
 *
 * The rules, in order: the last `turn/end` must exist and its reason must be
 * allowed by the policy; a `speak` tool call in that turn short-circuits to
 * {@link AutoReplyToolSpoke} when `skipIfToolSpoke` is on; the LAST
 * `assistant/message` of that turn supplies the text; a message with no
 * speakable text selects nothing. `enabled` and `skipSubagents` are caller
 * concerns (the controller and the mount), not log rules.
 *
 * @param events - `session.snapshotEvents()` of the finished session.
 * @param policy - the resolved auto-read policy.
 * @returns the reply, the speak-tool short-circuit, or null for "not handled".
 */
export function findAutoReply(events: readonly SessionEvent[], policy: AutoReplyPolicy): AutoReplyFinding | null {
  const endIndex = lastIndexOfType(events, 'turn/end')
  if (endIndex === -1) return null
  const end = events[endIndex]
  if (end === undefined || !isEventOfType(end, 'turn/end')) return null
  const why = reasonKindOf(end.data.reason)
  if (why === undefined || !(policy.reasons as readonly string[]).includes(why)) return null
  const turn = end.data.turn
  const startIndex = turnStartIndexOf(events, endIndex, turn)
  // A turn that already spoke through the tool is handled as soon as its reason
  // qualifies: the announcement must not follow the tool's own utterance, even
  // when the tool was the turn's last act and left no prose behind.
  if (policy.skipIfToolSpoke && hasSpeakToolCall(events, startIndex, endIndex, turn)) return { kind: 'tool-spoke' }
  const reply = lastAssistantMessageOf(events, startIndex, endIndex, turn)
  if (reply === undefined) return null
  const text = prepareAutoReplyText(reply.data.message.content, policy.maxChars)
  if (text === '') return null
  return { turn, messageId: String(reply.data.message.id), text }
}

/**
 * One running → idle transition's auto-read decision, with per-session dedupe.
 *
 * The caller mounts ONE controller per plugin instance: the WeakMap keys on the
 * `Session` object, so a reply is spoken at most once even when the agent loop
 * reports idle more than once for the same turn, while the entry disappears
 * with the session.
 */
export class AutoReplyController {
  /** Assistant message id already read, per session. */
  private readonly spokenMessages = new WeakMap<Session, string>()

  /**
   * @param policy - the resolved auto-read policy.
   * @param speak - speak callback (the talk service's `speak`).
   */
  constructor(
    private readonly policy: AutoReplyPolicy,
    private readonly speak: AutoReplySpeak,
  ) {}

  /**
   * Handle one finished turn. `true` means the turn is handled: the reply was
   * spoken (or already had been, or the speak tool covered it), so the caller
   * must skip the generic turn-end announcement. `false` leaves the existing
   * announcement path untouched. A rejected speak is swallowed — speech must
   * never break the `agent/status` listener.
   *
   * @param session - the session whose agent went idle.
   * @returns whether the turn was handled.
   */
  handle(session: Session): boolean {
    try {
      if (!this.policy.enabled) return false
      if (this.policy.skipSubagents && isSubagentSession(session)) return false
      const finding = findAutoReply(session.snapshotEvents(), this.policy)
      if (finding === null) return false
      if (!('turn' in finding)) return true
      if (this.spokenMessages.get(session) === finding.messageId) return true
      this.spokenMessages.set(session, finding.messageId)
      void this.speak(finding.text, { reason: 'auto-reply', session }).catch(() => undefined)
      return true
    } catch {
      // A log read cannot fail on a live session, but the listener must never
      // throw into the agent loop: fall back to the generic announcement.
      return false
    }
  }
}
