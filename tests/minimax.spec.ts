/**
 * MiniMax engine: batching, request shaping, SSE decoding, credential
 * resolution, collection, idle timeout and cancellation.
 *
 * @module dsh-talk/test/minimax.spec
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig } from '../src/config.ts'
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

/** A resolved policy with test-friendly values. */
function resolved(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    minimaxApiKeyEnv: ENV_NAME,
    minimaxCredentialsFile: null,
    minimaxBaseUrl: 'https://api.test/v1/t2a_v2',
    minimaxModel: 'speech-2.8-turbo',
    minimaxVoiceId: 'Chinese (Mandarin)_Warm_Girl',
    minimaxChunkChars: 500,
    minimaxRequestTimeoutMs: 5_000,
    announceEnabled: true,
    autoReplyEnabled: true,
    autoReplyMaxChars: 600,
    maxSpeakChars: 20_000,
    ...overrides,
  }
}

/** One SSE audio-chunk line carrying `hex`. */
function chunkLine(hex = '00ff'): string {
  return `data: {"data":{"status":1,"audio":"${hex}"},"base_resp":{"status_code":0,"status_msg":""}}\n`
}

/** One SSE final line carrying the batch duration and the repeated audio. */
function finalLine(hex = 'ff00'): string {
  return `data: {"data":{"status":2,"audio":"${hex}"},"extra_info":{"audio_length":1500,"usage_characters":2},"base_resp":{"status_code":0,"status_msg":""}}\n`
}

/** A streaming response over the given SSE lines; a held stream errors on abort. */
function sseResponse(lines: readonly string[], options: { hold?: boolean; status?: number; signal?: AbortSignal } = {}): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      if (options.hold !== true) {
        controller.close()
        return
      }
      options.signal?.addEventListener('abort', () => {
        try {
          controller.error(new DOMException('Aborted', 'AbortError'))
        } catch {
          // Already closed.
        }
      }, { once: true })
    },
  })
  return new Response(body, { status: options.status ?? 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('splitMinimaxText', () => {
  it('keeps short text as one batch and splits long text at sentence boundaries', () => {
    expect(splitMinimaxText('你好', 100)).toEqual(['你好'])
    expect(splitMinimaxText('', 100)).toEqual([])
    const text = `${'甲'.repeat(60)}。${'乙'.repeat(60)}。`
    const batches = splitMinimaxText(text, 100)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.join('')).toBe(text)
    expect(batches[0]?.endsWith('。')).toBe(true)
  })
})

describe('minimaxRequestBody', () => {
  it('shapes the T2A request for streaming MP3', () => {
    const body = minimaxRequestBody(resolved(), '你好', 'voice-x', true)
    expect(body).toMatchObject({
      model: 'speech-2.8-turbo',
      text: '你好',
      stream: true,
      voice_setting: { voice_id: 'voice-x' },
      audio_setting: { format: 'mp3', sample_rate: 32_000 },
      language_boost: 'Chinese',
    })
  })
})

describe('parseMinimaxSseLine', () => {
  it('decodes audio chunks, final duration and API errors', () => {
    expect(parseMinimaxSseLine(chunkLine('00ff'))).toMatchObject({ status: 1, audio: new Uint8Array([0, 255]) })
    expect(parseMinimaxSseLine(finalLine('ff00'))).toMatchObject({ status: 2, audioLengthMs: 1500, usageCharacters: 2 })
    expect(parseMinimaxSseLine('data: {"base_resp":{"status_code":1004,"status_msg":"invalid api key"}}')).toMatchObject({
      errorCode: 1004,
      errorMessage: 'invalid api key',
    })
    expect(parseMinimaxSseLine('')).toBeNull()
    expect(parseMinimaxSseLine('data: [DONE]')).toBeNull()
    expect(parseMinimaxSseLine('event: ping')).toBeNull()
  })
})

describe('credential resolution', () => {
  it('parses the refs section', () => {
    expect(parseCredentialRefs("refs:\n  MINIMAX_CN_API_KEY: 'sk-test'\n  OTHER: x\nnot-refs: y\n")).toEqual({
      MINIMAX_CN_API_KEY: 'sk-test',
      OTHER: 'x',
    })
  })

  it('prefers the environment variable, then the credential file', async () => {
    process.env[ENV_NAME] = '  sk-env  '
    await expect(resolveMinimaxApiKey(resolved())).resolves.toBe('sk-env')
    delete process.env[ENV_NAME]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-talk-key-'))
    try {
      const file = join(dir, 'credentials.yaml')
      await writeFile(file, `refs:\n  ${ENV_NAME}: sk-file\n`, 'utf8')
      await expect(resolveMinimaxApiKey(resolved({ minimaxCredentialsFile: file }))).resolves.toBe('sk-file')
      await expect(resolveMinimaxApiKey(resolved())).resolves.toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('MinimaxEngine.synthesize', () => {
  it('concatenates the streamed chunks into one MP3 and reports the duration', async () => {
    process.env[ENV_NAME] = 'sk-test'
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([chunkLine('00ff'), chunkLine('0102'), finalLine('ff00')])))
    const result = await new MinimaxEngine(resolved()).synthesize('你好', new AbortController().signal)
    expect(result.mime).toBe('audio/mpeg')
    expect([...result.data]).toEqual([0, 255, 1, 2])
    expect(result.audioSec).toBe(1.5)
  })

  it('fails without an API key, on HTTP errors and on API error codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([])))
    await expect(new MinimaxEngine(resolved()).synthesize('你好', new AbortController().signal)).rejects.toThrow(/no API key/u)
    process.env[ENV_NAME] = 'sk-test'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(new MinimaxEngine(resolved()).synthesize('你好', new AbortController().signal)).rejects.toThrow(/HTTP 500/u)
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"base_resp":{"status_code":1004,"status_msg":"invalid api key"}}\n'])))
    await expect(new MinimaxEngine(resolved()).synthesize('你好', new AbortController().signal)).rejects.toThrow(/1004/u)
  })

  it('treats a silent stream as an idle stall and honours cancellation', async () => {
    process.env[ENV_NAME] = 'sk-test'
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
      sseResponse([], { hold: true, ...(init?.signal === undefined || init.signal === null ? {} : { signal: init.signal }) })))
    await expect(new MinimaxEngine(resolved({ minimaxRequestTimeoutMs: 50 })).synthesize('你好', new AbortController().signal))
      .rejects.toThrow(/stalled/u)

    const controller = new AbortController()
    let release: (() => void) | undefined
    vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>((resolve) => {
      release = () => resolve(sseResponse([chunkLine()]))
    })))
    const pending = new MinimaxEngine(resolved()).synthesize('你好', controller.signal)
    await new Promise(r => setTimeout(r, 10))
    controller.abort()
    release?.()
    await expect(pending).rejects.toMatchObject({ aborted: true })
  })

  it('classifies an aborted signal before any request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new MinimaxEngine(resolved()).synthesize('你好', controller.signal))
      .rejects.toBeInstanceOf(EngineFailure)
    expect(resolveConfig({}).minimaxModel).toBe('speech-2.8-turbo')
  })
})
