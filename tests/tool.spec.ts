/**
 * The speak tool through the REAL tool registry: registration, schema
 * validation, the browser-engine fast path, the local-engine failure →
 * browser fallback, and the interrupt outcome. The subprocess provider is
 * scripted; every other piece of the pipeline runs for real.
 *
 * @module dsh-talk/test/tool.spec
 */

import { describe, expect, it } from 'vitest'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { mountHarness, speechEventsOf, withKnownSpeechVocabulary, type Harness } from './harness.ts'

let callCounter = 0

/** Execute-parameter brand of the call id (CallId on rc.2, ToolCallId on 0.1.2-alpha). */
type ExecuteArgs = Parameters<Harness['ctx']['tools']['execute']>[0]

/** Build a call id typed to whichever brand the resolved tool registry expects. */
function callIdOf(id: string): ExecuteArgs['callId'] {
  return id as ExecuteArgs['callId']
}

async function callTool(harness: Harness, args: unknown): Promise<ToolExecutionResult> {
  callCounter += 1
  return harness.ctx.tools.execute({
    callId: callIdOf(`talk-spec-${callCounter}`),
    name: 'speak',
    arguments: args,
    agent: harness.agent,
    signal: new AbortController().signal,
  })
}

describe('speak tool', () => {
  it('registers in the real registry', async () => {
    const harness = await mountHarness()
    expect(harness.ctx.tools.get('speak')).toBeDefined()
  })

  it('rejects empty text', async () => {
    const harness = await mountHarness()
    const result = await callTool(harness, { text: '   ' })
    expect(result.isError).toBe(true)
  })

  it('speaks through the browser engine without subprocess I/O and appends the plugin record', async () => {
    const harness = await mountHarness()
    const result = await callTool(harness, { text: 'hello', engine: 'browser' })
    expect(result.isError).toBe(false)
    if (result.isError) return
    const value = result.value as { spoken: boolean; engine: string; audioBytes: number }
    expect(value.spoken).toBe(true)
    expect(value.engine).toBe('browser')
    expect(value.audioBytes).toBe(0)
    // This host's vocabulary excludes the out-of-repo speech type, so the gate
    // appends the utterance as an ignorable plugin record — logged, not
    // skipped. The `speak` tool result stays the model-visible record.
    const speech = speechEventsOf(harness.session)
    expect(speech).toHaveLength(1)
    expect(speech[0]?.type).toBe('plugin:dsh-talk/speech')
    expect(harness.service.speechLogOutcome(String(harness.session.id))).toMatchObject({ appended: 1, skipped: 0 })
  })

  it('appends the plain speech event when the host vocabulary covers it (explicit opt-in)', async () => {
    await withKnownSpeechVocabulary(async () => {
      const harness = await mountHarness()
      await callTool(harness, { text: 'hello', engine: 'browser' })
      const speech = harness.session.snapshotEvents().filter(event => event.type === 'dsh-talk/speech')
      expect(speech).toHaveLength(1)
      expect(harness.service.speechLogOutcome(String(harness.session.id))).toMatchObject({ appended: 1, skipped: 0 })
    })
  })

  it('carries browser delivery settings and the per-call voice override in the speech event', async () => {
    await withKnownSpeechVocabulary(async () => {
      const harness = await mountHarness({ tts: { browser: { voiceName: 'Configured Voice', rate: 1.5, pitch: 0.8 } } })
      await callTool(harness, { text: 'hello', engine: 'browser' })
      let data = (harness.session.snapshotEvents().filter(event => event.type === 'dsh-talk/speech').at(-1)?.data ?? {}) as {
        voice?: string
        rate?: number
        pitch?: number
      }
      expect(data.voice).toBe('Configured Voice')
      expect(data.rate).toBe(1.5)
      expect(data.pitch).toBe(0.8)
      await callTool(harness, { text: 'hello again', engine: 'browser', voice: 'Override Voice' })
      data = (harness.session.snapshotEvents().filter(event => event.type === 'dsh-talk/speech').at(-1)?.data ?? {}) as typeof data
      expect(data.voice).toBe('Override Voice')
      expect(data.rate).toBe(1.5)
      expect(data.pitch).toBe(0.8)
    })
  })

  it('omits browser delivery fields on local-engine utterances', async () => {
    await withKnownSpeechVocabulary(async () => {
      const harness = await mountHarness()
      harness.subprocess.nextSynthBytes = 'ID3-fake-audio'
      const result = await callTool(harness, { text: 'hello', engine: 'edge-tts', interrupt: false })
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected successful local synthesis')
      expect(result.value).toMatchObject({ spoken: true, engine: 'edge-tts' })
      const data = (harness.session.snapshotEvents().filter(event => event.type === 'dsh-talk/speech').at(-1)?.data ?? {}) as Record<string, unknown>
      expect(data.engine).toBe('edge-tts')
      expect('voice' in data).toBe(false)
      expect('rate' in data).toBe(false)
      expect('pitch' in data).toBe(false)
    })
  })

  it('falls back to the browser voice when edge-tts fails', async () => {
    const harness = await mountHarness()
    harness.subprocess.nextExitCode = 1
    harness.subprocess.nextStderr = 'edge-tts exploded'
    const result = await callTool(harness, { text: 'hello', engine: 'edge-tts', interrupt: false })
    expect(result.isError).toBe(false)
    if (result.isError) return
    const value = result.value as { engine: string; error?: string }
    expect(value.engine).toBe('browser')
    expect(value.error).toContain('edge-tts')
    expect(harness.subprocess.spawns.length).toBeGreaterThan(0)
  })

  it.skipIf(process.platform !== 'darwin')('synthesizes through the macOS say engine and exports a wav', async () => {
    await withKnownSpeechVocabulary(async () => {
      const harness = await mountHarness()
      harness.subprocess.nextSynthBytes = 'RIFF-fake-macos-audio'
      const result = await callTool(harness, { text: '你好', engine: 'macos', interrupt: false })
      expect(result.isError).toBe(false)
      if (result.isError) return
      const value = result.value as {
        spoken?: boolean
        engine?: string
        audioBytes?: number
        audioPath?: string
        audioExport?: string
      }
      expect(value.spoken).toBe(true)
      expect(value.engine).toBe('macos')
      expect(value.audioBytes).toBe('RIFF-fake-macos-audio'.length)
      expect(value.audioExport).toBe('file')
      expect(value.audioPath?.endsWith('.wav')).toBe(true)
      // Two spawns: the installed-voice table first, then the synthesis itself.
      const saySpawn = harness.subprocess.spawns.at(-1)
      expect(saySpawn?.argv[0]).toBe('/usr/bin/say')
      expect(saySpawn?.argv).toContain('--file-format=WAVE')
      expect(saySpawn?.argv).toContain('--data-format=LEI16@22050')
      const stdin = (saySpawn?.stdio as unknown as { stdin?: { data?: string } } | undefined)?.stdin
      expect(stdin?.data).toBe('你好')
      const speech = speechEventsOf(harness.session).at(-1)?.data as { engine?: string; audioBytes?: number } | undefined
      expect(speech?.engine).toBe('macos')
      expect(speech?.audioBytes).toBe('RIFF-fake-macos-audio'.length)
    })
  })

  it('falls back to the browser voice when the macos engine cannot run', async () => {
    const harness = await mountHarness()
    harness.subprocess.nextExitCode = 1
    harness.subprocess.nextStderr = 'say exploded'
    const result = await callTool(harness, { text: 'hello', engine: 'macos', interrupt: false })
    expect(result.isError).toBe(false)
    if (result.isError) return
    const value = result.value as { engine?: string; error?: string }
    expect(value.engine).toBe('browser')
    expect(value.error).toContain('macos')
  })

  it('refuses a hostile engine value at the schema boundary', async () => {
    const harness = await mountHarness()
    const result = await callTool(harness, { text: 'hi', engine: 'rm-rf' })
    expect(result.isError).toBe(true)
  })
})
