/**
 * MiniMax cloud engine: batch splitting, request shaping, SSE decoding,
 * credential resolution, and the configuration contract.
 *
 * @module dsh-talk/test/minimax.spec
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import {
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
})

describe('splitMinimaxText', () => {
  it('keeps short text in one batch', () => {
    expect(splitMinimaxText('你好，世界。', 2_000)).toEqual(['你好，世界。'])
  })

  it('splits at a sentence boundary and preserves every character', () => {
    const text = `${'第一句。'.repeat(30)}${'第二句。'.repeat(30)}`
    const batches = splitMinimaxText(text, 100)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.every(batch => batch.length <= 100)).toBe(true)
    expect(batches.join('')).toBe(text)
    expect(batches[0]?.endsWith('。')).toBe(true)
  })

  it('hard-splits when no boundary exists near the limit', () => {
    const text = 'a'.repeat(250)
    const batches = splitMinimaxText(text, 100)
    expect(batches.map(batch => batch.length)).toEqual([100, 100, 50])
    expect(batches.join('')).toBe(text)
  })

  it('returns no batch for empty text', () => {
    expect(splitMinimaxText('', 100)).toEqual([])
  })
})

describe('minimaxRequestBody', () => {
  it('shapes the speech-2.8 streaming request with the configured defaults', () => {
    const resolved = resolveConfig({})
    const body = minimaxRequestBody(resolved, '你好', resolved.minimaxVoiceId, true)
    expect(body['model']).toBe('speech-2.8-turbo')
    expect(body['stream']).toBe(true)
    expect(body['language_boost']).toBe('Chinese')
    expect(body['text_normalization_mode']).toBe('basic')
    expect(body['audio_setting']).toEqual({ sample_rate: 32_000, bitrate: 128_000, format: 'mp3', channel: 1 })
    expect(body['voice_setting']).toMatchObject({ voice_id: resolved.minimaxVoiceId, speed: 1, vol: 1, pitch: 0 })
    expect(body['voice_setting']).not.toHaveProperty('emotion')
  })

  it('maps tts.rate onto the API speed and includes the configured emotion', () => {
    const resolved = resolveConfig({ tts: { rate: 20, minimax: { emotion: 'happy', sampleRate: 24_000 } } })
    const body = minimaxRequestBody(resolved, '你好', 'Chinese (Mandarin)_Warm_Girl', true)
    expect((body['voice_setting'] as Record<string, unknown>)['speed']).toBeCloseTo(1.2)
    expect((body['voice_setting'] as Record<string, unknown>)['emotion']).toBe('happy')
    expect((body['audio_setting'] as Record<string, unknown>)['sample_rate']).toBe(24_000)
  })
})

describe('parseMinimaxSseLine', () => {
  it('decodes a chunk event', () => {
    const event = parseMinimaxSseLine('data: {"data":{"status":1,"audio":"00ff"},"base_resp":{"status_code":0,"status_msg":""}}')
    expect(event?.status).toBe(1)
    expect(event?.audio).toEqual(new Uint8Array([0, 255]))
    expect(event?.errorCode).toBe(0)
  })

  it('reads duration and usage from the final event', () => {
    const event = parseMinimaxSseLine(
      'data: {"data":{"status":2,"audio":""},"extra_info":{"audio_length":9090,"usage_characters":42},"base_resp":{"status_code":0,"status_msg":"success"}}',
    )
    expect(event?.status).toBe(2)
    expect(event?.audioLengthMs).toBe(9_090)
    expect(event?.usageCharacters).toBe(42)
  })

  it('surfaces a base_resp failure', () => {
    const event = parseMinimaxSseLine('data: {"data":null,"base_resp":{"status_code":1004,"status_msg":"invalid api key"}}')
    expect(event?.errorCode).toBe(1004)
    expect(event?.errorMessage).toBe('invalid api key')
  })

  it('ignores blank, done, non-data, and malformed lines', () => {
    expect(parseMinimaxSseLine('')).toBeNull()
    expect(parseMinimaxSseLine('data: [DONE]')).toBeNull()
    expect(parseMinimaxSseLine(': keep-alive')).toBeNull()
    expect(parseMinimaxSseLine('data: {oops')).toBeNull()
    expect(parseMinimaxSseLine('data: {"data":{"status":1,"audio":"zz"}}')?.audio).toBeNull()
  })
})

describe('parseCredentialRefs', () => {
  it('reads only the refs section and unquotes values', () => {
    const yaml = [
      'version: 1',
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
  it('prefers the explicit config value', async () => {
    process.env[ENV_NAME] = 'from-env'
    const resolved = resolveConfig({ tts: { minimax: { apiKey: 'from-config', apiKeyEnv: ENV_NAME } } })
    await expect(resolveMinimaxApiKey(resolved)).resolves.toBe('from-config')
  })

  it('falls back to the configured environment variable', async () => {
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

describe('minimax config', () => {
  it('resolves the documented defaults', () => {
    const resolved = resolveConfig({})
    expect(resolved.ttsEngine).toBe('auto')
    expect(resolved.minimaxBaseUrl).toBe('https://api.minimax.cn/v1/t2a_v2')
    expect(resolved.minimaxModel).toBe('speech-2.8-turbo')
    expect(resolved.minimaxVoiceId).toBe('Chinese (Mandarin)_Warm_Girl')
    expect(resolved.minimaxLanguageBoost).toBe('Chinese')
    expect(resolved.minimaxPlayer).toBe('ffplay')
    expect(resolved.minimaxStreaming).toBe(true)
    expect(resolved.minimaxSampleRate).toBe(32_000)
    expect(resolved.minimaxBatchChars).toBe(2_000)
    expect(resolved.minimaxRequestTimeoutMs).toBe(120_000)
    expect(resolved.minimaxApiKeyEnv).toBe('MINIMAX_CN_API_KEY')
    expect(resolved.minimaxEmotion).toBeNull()
  })

  it('accepts the minimax engine selection', () => {
    expect(resolveConfig({ tts: { engine: 'minimax' } }).ttsEngine).toBe('minimax')
  })

  it('rejects an unknown emotion, a non-http endpoint, and an out-of-range batch size', () => {
    expect(() => resolveConfig({ tts: { minimax: { emotion: 'grumpy' } } })).toThrow(/emotion/u)
    expect(() => resolveConfig({ tts: { minimax: { baseUrl: 'ftp://example.com' } } })).toThrow(/baseUrl/u)
    expect(() => resolveConfig({ tts: { minimax: { batchChars: 100 } } })).toThrow(/batchChars/u)
    expect(() => resolveConfig({ tts: { minimax: { apiKeyEnv: 'not a shell name' } } })).toThrow(/apiKeyEnv/u)
  })
})
