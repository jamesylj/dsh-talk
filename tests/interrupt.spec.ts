/**
 * Scoped interruption: a new utterance only preempts speech the SAME session
 * already had in flight, so a long read is never cancelled by another
 * session's speak request; announcement listeners never preempt at all (they
 * stay silent instead of queueing a stale line behind a long read); and the
 * mic button's unscoped interrupt still stops every session.
 *
 * The subprocess provider is scripted and one spawn can be held open through
 * `nextDoneGate`, which is what keeps a synthesis in flight while the abort is
 * applied.
 *
 * @module dsh-talk/test/interrupt.spec
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it } from 'vitest'
import { SessionId, mountHarness, type Harness } from './harness.ts'

/** A promise plus the resolver that releases it. */
interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

/** Create one deferred gate. */
function deferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

/** Poll until `predicate` is true or the timeout expires. */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the harness condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** One in-flight (held) synthesis plus the facts its assertions need. */
interface HangingSpeak {
  /** Resolves when the speak pipeline finishes after the gate is released. */
  readonly done: Promise<unknown>
  /** Releases the held spawn (the synthesis then completes normally). */
  readonly release: () => void
  /** The spawn spec of the held synthesis (its `signal` is the abort seam). */
  readonly spec: SubprocessSpawnSpec
}

/**
 * Start one speak request and hold its subprocess spawn open.
 *
 * @param harness - the mounted harness.
 * @param text - utterance text.
 * @param session - the owning session (the preemption scope).
 * @param interrupt - the preemption flag; `undefined` keeps the pipeline default.
 * @returns the held synthesis.
 */
async function startHangingSpeak(
  harness: Harness,
  text: string,
  session: Session,
  interrupt?: boolean,
): Promise<HangingSpeak> {
  const gate = deferred()
  harness.subprocess.nextDoneGate = gate.promise
  harness.subprocess.nextSynthBytes = 'MP3-BYTES'
  const before = harness.subprocess.spawns.length
  const done = harness.service.speak(text, {
    reason: 'speak-tool',
    session,
    ...(interrupt === undefined ? {} : { interrupt }),
  })
  await waitFor(() => harness.subprocess.spawns.length > before)
  return { done, release: gate.resolve, spec: harness.subprocess.spawns[before] as SubprocessSpawnSpec }
}

/** A mount with the scripted edge-tts engine (exactly one spawn per utterance). */
async function mount(): Promise<Harness> {
  return mountHarness({ tts: { engine: 'edge-tts' } })
}

describe('scoped interruption', () => {
  it('stops only the named session\'s in-flight synthesis', async () => {
    const harness = await mount()
    const other = harness.ctx.sessions.create(SessionId('dsh-talk-interrupt-other'))
    const first = await startHangingSpeak(harness, 'long read', harness.session, false)
    const second = await startHangingSpeak(harness, 'other session read', other, false)

    harness.service.interrupt({ sessionId: String(harness.session.id) })

    expect(first.spec.signal?.aborted).toBe(true)
    expect(second.spec.signal?.aborted).toBe(false)
    first.release()
    second.release()
    await Promise.all([first.done, second.done])
  })

  it('lets the mic button stop every session (unscoped interrupt)', async () => {
    const harness = await mount()
    const other = harness.ctx.sessions.create(SessionId('dsh-talk-interrupt-mic'))
    const first = await startHangingSpeak(harness, 'long read', harness.session, false)
    const second = await startHangingSpeak(harness, 'other session read', other, false)

    expect(harness.service.interrupt().stopped).toBe(true)

    expect(first.spec.signal?.aborted).toBe(true)
    expect(second.spec.signal?.aborted).toBe(true)
    first.release()
    second.release()
    await Promise.all([first.done, second.done])
  })

  it('preempts only the calling session, never another session\'s read', async () => {
    const harness = await mount()
    const other = harness.ctx.sessions.create(SessionId('dsh-talk-interrupt-preempt'))
    // The long read being protected: a same-session speak with the default
    // (preempt) flag — nobody else is speaking yet, so it starts.
    const longRead = await startHangingSpeak(harness, 'the long reply', harness.session)
    // Another session's new utterance must NOT cancel it.
    const otherSpeak = await startHangingSpeak(harness, 'another session', other)
    // A new same-session utterance DOES preempt the session's own read.
    const sameSession = await startHangingSpeak(harness, 'explicit interruption', harness.session, true)

    expect(longRead.spec.signal?.aborted).toBe(true)
    expect(otherSpeak.spec.signal?.aborted).toBe(false)
    expect(sameSession.spec.signal?.aborted).toBe(false)
    longRead.release()
    otherSpeak.release()
    sameSession.release()
    await Promise.all([longRead.done, otherSpeak.done, sameSession.done])
  })

  it('treats interrupt: false as no preemption at all', async () => {
    const harness = await mount()
    const first = await startHangingSpeak(harness, 'long read', harness.session, false)
    const second = await startHangingSpeak(harness, 'queued read', harness.session, false)

    expect(first.spec.signal?.aborted).toBe(false)
    expect(second.spec.signal?.aborted).toBe(false)
    first.release()
    second.release()
    await Promise.all([first.done, second.done])
  })

  it('skips the turn-end announcement while any read is in flight', async () => {
    const harness = await mountHarness({
      tts: { engine: 'edge-tts' },
      autoReply: { enabled: false },
      announce: { onTurnEnd: true },
    })
    const other = harness.ctx.sessions.create(SessionId('dsh-talk-interrupt-announce'))
    const read = await startHangingSpeak(harness, 'a long read', other, false)
    const spawnsBefore = harness.subprocess.spawns.length

    harness.ctx.emit('agent/status', { agent: harness.agent, status: 'running' })
    harness.ctx.emit('agent/status', { agent: harness.agent, status: 'idle' })
    await new Promise(resolve => setTimeout(resolve, 30))

    // No "Turn complete." synthesis was queued behind the read, and the read
    // itself was not aborted.
    expect(harness.subprocess.spawns.length).toBe(spawnsBefore)
    expect(read.spec.signal?.aborted).toBe(false)
    expect(harness.service.speechLogOutcome(String(harness.session.id))).toBeUndefined()

    read.release()
    await read.done
  })
})
