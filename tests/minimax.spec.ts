/**
 * MiniMax engine: batch splitting, request shaping, SSE decoding, credential
 * resolution, idle-timeout/backpressure behavior and EPIPE safety.
 *
 * @module dsh-talk/test/minimax.spec
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { EngineFailure } from '../src/engine.ts'
import {
  MinimaxEngine,
  minimaxRequestBody,
  parseCredentialRefs,
  parseMinimaxSseLine,
  resolveMinimaxApiKey,
  splitMinimaxText,
} from '../src/minimax.ts'

const ENV_NAME = 'DSH_TALK_TEST_MINIMAX_KEY'
const savedEnv = process.env[ENV_NAME]

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_NAME]
  else process.env[ENV_NAME] = savedEnv
  vi.unstubAllGlobals()
})

/** Minimal player process: a writable stdin sink and an exit promise. */
function fakePlayer(options: {
  onWrite?: (chunk: Buffer, done: (error?: Error) => void) => void
  exit?: { exitCode: number | null; signal: NodeJS.Signals | null }
  exitNow?: boolean
} = {}) {
  const stdin = new Writable({
    write(chunk: Buffer, _encoding, done) {
      options.onWrite?.(chunk, done)
      if (options.onWrite === undefined) done()
    },
  })
  const done = options.exitNow === true
    ? Promise.resolve(options.exit ?? { exitCode: 1, signal: null })
    : new Promise(resolve => stdin.on('finish', () => resolve(options.exit ?? { exitCode: 0, signal: null })))
  const handle = {
    stdin,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {},
    done,
    terminate: (): void => { if (!stdin.destroyed) stdin.destroy() },
    waitForExit: async () => true,
  }
  return { spawn: () => handle, resolveExecutable: async (command: string) => command }
}

/** One SSE `data:` line with an audio chunk. */
function chunkLine(hex = '00ff'): string {
  return `data: {"data":{"status":1,"audio":"${hex}"},"base_resp":{"status_code":0,"status_msg":""}}\n`
}

/** A streaming response wired to the fetch abort signal. */
function sseResponse(init: RequestInit | undefined, lines: readonly string[], hold = false): Response {
  const encoder = new TextEncoder()
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < lines.length) {
        controller.enqueue(encoder.encode(lines[index] as string))
        index += 1
        return
      }
      if (hold) return
      controller.close()
    },
    start(controller) {
      if (!hold) return
      init?.signal?.addEventListener('abort', () => {
        try {
          controller.error(new DOMException('The operation was aborted', 'AbortError'))
        } catch {
          // Already closed.
        }
      }, { once: true })
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('splitMinimaxText', () => {
  it('keeps short text in one batch', () => {
    expect(splitMinimaxText('你好，世界。', 2_000)).toEqual(['你好，世界。'])
  })

  it('splits at sentence boundaries and preserves every character', () => {
    const text = `${'第一句。'.repeat(30)}${'第二句。'.repeat(30)}`
    const batches = splitMinimaxText(text, 100)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.every(batch => batch.length <= 100)).toBe(true)
    expect(batches.join('')).toBe(text)
    expect(batches[0]?.endsWith('。')).toBe(true)
  })

  it('hard-splits when no boundary exists near the limit', () => {
    const text = 'a'.repeat(250)
    expect(splitMinimaxText(text, 100).map(batch => batch.length)).toEqual([100, 100, 50])
  })

  it('returns no batch for empty text', () => {
    expect(splitMinimaxText('', 100)).toEqual([])
  })
})

describe('minimaxRequestBody', () => {
  it('shapes the speech-2.8 streaming request with fixed audio settings', () => {
    const resolved = resolveConfig({})
    const body = minimaxRequestBody(resolved, '你好', resolved.minimaxVoiceId, true)
    expect(body['model']).toBe('speech-2.8-turbo')
    expect(body['stream']).toBe(true)
    expect(body['language_boost']).toBe('Chinese')
    expect(body['text_normalization_mode']).toBe('basic')
    expect(body['audio_setting']).toEqual({ sample_rate: 32_000, bitrate: 128_000, format: 'mp3', channel: 1 })
    expect(body['voice_setting']).toMatchObject({ voice_id: resolved.minimaxVoiceId, speed: 1, vol: 1, pitch: 0 })
  })
})

describe('parseMinimaxSseLine', () => {
  it('decodes a chunk event', () => {
    const event = parseMinimaxSseLine('data: {"data":{"status":1,"audio":"00ff"},"base_resp":{"status_code":0,"status_msg":""}}')
    expect(event?.status).toBe(1)
    expect(event?.audio).toEqual(new Uint8Array([0, 255]))
  })

  it('reads duration and usage from the final event', () => {
    const event = parseMinimaxSseLine(
      'data: {"data":{"status":2,"audio":""},"extra_info":{"audio_length":9090,"usage_characters":42},"base_resp":{"status_code":0,"status_msg":"success"}}',
    )
    expect(event?.audioLengthMs).toBe(9_090)
    expect(event?.usageCharacters).toBe(42)
  })

  it('surfaces a base_resp failure and ignores malformed lines', () => {
    expect(parseMinimaxSseLine('data: {"data":null,"base_resp":{"status_code":1004,"status_msg":"invalid api key"}}')?.errorCode).toBe(1004)
    expect(parseMinimaxSseLine('')).toBeNull()
    expect(parseMinimaxSseLine('data: [DONE]')).toBeNull()
    expect(parseMinimaxSseLine(': keep-alive')).toBeNull()
    expect(parseMinimaxSseLine('data: {oops')).toBeNull()
  })
})

describe('parseCredentialRefs', () => {
  it('reads only the refs section and unquotes values', () => {
    const yaml = [
      'records:',
      '  a/b:',
      '    kind: api-key',
      'refs:',
      `  ${ENV_NAME}: "secret-value"`,
      '  OTHER_KEY: plain',
      'settings:',
      '  nested: ignored',
    ].join('\n')
    expect(parseCredentialRefs(yaml)).toEqual({ [ENV_NAME]: 'secret-value', OTHER_KEY: 'plain' })
  })
})

describe('resolveMinimaxApiKey', () => {
  it('prefers the environment variable', async () => {
    process.env[ENV_NAME] = 'from-env'
    const resolved = resolveConfig({ tts: { minimax: { apiKeyEnv: ENV_NAME, credentialsFile: '' } } })
    await expect(resolveMinimaxApiKey(resolved)).resolves.toBe('from-env')
  })

  it('falls back to the harness credential store', async () => {
    delete process.env[ENV_NAME]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-talk-minimax-test-'))
    try {
      const file = join(dir, 'credentials.yaml')
      await writeFile(file, `refs:\n  ${ENV_NAME}: stored-key\n`, 'utf8')
      const resolved = resolveConfig({ tts: { minimax: { apiKeyEnv: ENV_NAME, credentialsFile: file } } })
      await expect(resolveMinimaxApiKey(resolved)).resolves.toBe('stored-key')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns null when nothing is configured', async () => {
    delete process.env[ENV_NAME]
    const resolved = resolveConfig({ tts: { minimax: { apiKeyEnv: ENV_NAME, credentialsFile: '' } } })
    await expect(resolveMinimaxApiKey(resolved)).resolves.toBeNull()
  })
})

describe('MinimaxEngine', () => {
  it('streams the SSE chunks into the player and reports the duration', async () => {
    process.env[ENV_NAME] = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => sseResponse(init, [
      chunkLine('00ff'),
      chunkLine('aabb'),
      'data: {"data":{"status":2,"audio":""},"extra_info":{"audio_length":2500},"base_resp":{"status_code":0,"status_msg":"success"}}\n',
    ])))
    const fake = fakePlayer()
    const engine = new MinimaxEngine(fake as never, resolveConfig({ tts: { minimax: { apiKeyEnv: ENV_NAME, credentialsFile: '' } } }))
    const result = await engine.synthesize('你好', new AbortController().signal)
    expect(result.data).toEqual(new Uint8Array([0, 255, 0xaa, 0xbb]))
    expect(result.audioSec).toBeCloseTo(2.5)
  })

  it('fails as an idle stall on a silent stream', async () => {
    process.env[ENV_NAME] = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => sseResponse(init, [], true)))
    const base = resolveConfig({ tts: { minimax: { apiKeyEnv: ENV_NAME, credentialsFile: '' } } })
    const engine = new MinimaxEngine(fakePlayer() as never, { ...base, minimaxRequestTimeoutMs: 400 })
    const error = await engine.synthesize('你好', new AbortController().signal).then(() => null, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(EngineFailure)
    expect((error as EngineFailure).aborted).toBe(false)
    expect((error as EngineFailure).message).toMatch(/stalled/u)
  })

  it('keeps a slow realtime player streaming past the idle budget in total time', async () => {
    process.env[ENV_NAME] = 'test-key'
    const lines = Array.from({ length: 6 }, () => chunkLine())
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => sseResponse(init, [
      ...lines,
      'data: {"data":{"status":2,"audio":""},"extra_info":{"audio_length":1000},"base_resp":{"status_code":0,"status_msg":"success"}}\n',
    ])))
    const base = resolveConfig({ tts: { minimax: { apiKeyEnv: ENV_NAME, credentialsFile: '' } } })
    const fake = fakePlayer({ onWrite: (_chunk, done) => setTimeout(done, 150) })
    const engine = new MinimaxEngine(fake as never, { ...base, minimaxRequestTimeoutMs: 400 })
    const result = await engine.synthesize('你好', new AbortController().signal)
    expect(result.data.byteLength).toBe(12)
  }, 10_000)

  it('turns a dead player stdin (EPIPE) into an engine failure', async () => {
    process.env[ENV_NAME] = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => sseResponse(init, [chunkLine()])))
    const fake = fakePlayer({ onWrite: (_chunk, done) => done(new Error('write EPIPE')), exitNow: true })
    const engine = new MinimaxEngine(fake as never, resolveConfig({ tts: { minimax: { apiKeyEnv: ENV_NAME, credentialsFile: '' } } }))
    const error = await engine.synthesize('你好', new AbortController().signal).then(() => null, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(EngineFailure)
    expect((error as EngineFailure).aborted).toBe(false)
    expect((error as EngineFailure).message).toMatch(/EPIPE|player/u)
  })

  it('surfaces a base_resp API error', async () => {
    process.env[ENV_NAME] = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => sseResponse(init, [
      'data: {"data":null,"base_resp":{"status_code":1004,"status_msg":"invalid api key"}}\n',
    ])))
    const engine = new MinimaxEngine(fakePlayer() as never, resolveConfig({ tts: { minimax: { apiKeyEnv: ENV_NAME, credentialsFile: '' } } }))
    await expect(engine.synthesize('你好', new AbortController().signal)).rejects.toThrow(/1004/u)
  })
})
