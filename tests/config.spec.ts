/**
 * Configuration contract: defaults, bounds, engine rules and the v0.5 key set.
 *
 * @module dsh-talk/test/config.spec
 */

import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('resolves the documented v0.5 defaults', () => {
    const resolved = resolveConfig({})
    expect(resolved.ttsEngine).toBe('minimax')
    expect(resolved.ttsFallback).toBe(true)
    expect(resolved.minimaxBaseUrl).toBe('https://api.minimax.cn/v1/t2a_v2')
    expect(resolved.minimaxModel).toBe('speech-2.8-turbo')
    expect(resolved.minimaxVoiceId).toBe('Chinese (Mandarin)_Warm_Girl')
    expect(resolved.minimaxPlayer).toBe('ffplay')
    expect(resolved.minimaxChunkChars).toBe(2_000)
    expect(resolved.minimaxRequestTimeoutMs).toBe(120_000)
    expect(resolved.minimaxApiKeyEnv).toBe('MINIMAX_CN_API_KEY')
    expect(resolved.minimaxCredentialsFile).toBe('/Users/jambone/.dsh/.credentials.yaml')
    expect(resolved.mlxModel).toContain('qwen3-tts-0.6b-base-4bit')
    expect(resolved.mlxRefAudio).toBeNull()
    expect(resolved.ttsExportEnabled).toBe(false)
    expect(resolved.announceEnabled).toBe(true)
    expect(resolved.autoReplyEnabled).toBe(true)
    expect(resolved.autoReplyMaxChars).toBe(600)
    expect(resolved.maxSpeakChars).toBe(20_000)
  })

  it('accepts both engines and rejects anything else', () => {
    expect(resolveConfig({ tts: { engine: 'mlx', mlx: { refAudio: '/tmp/ref.wav' } } }).ttsEngine).toBe('mlx')
    expect(() => resolveConfig({ tts: { engine: 'piper' as never } })).toThrow(/minimax.*mlx/u)
  })

  it('requires a reference WAV for the mlx engine', () => {
    expect(() => resolveConfig({ tts: { engine: 'mlx' } })).toThrow(/refAudio/u)
  })

  it('accepts a minimax-only setup without mlx refAudio (fallback simply unavailable)', () => {
    const resolved = resolveConfig({ tts: { engine: 'minimax' } })
    expect(resolved.ttsFallback).toBe(true)
    expect(resolved.mlxRefAudio).toBeNull()
  })

  it('rejects out-of-range and malformed values', () => {
    expect(() => resolveConfig({ tts: { minimax: { chunkChars: 100 } } })).toThrow(/chunkChars/u)
    expect(() => resolveConfig({ tts: { minimax: { requestTimeoutMs: 100 } } })).toThrow(/requestTimeoutMs/u)
    expect(() => resolveConfig({ tts: { minimax: { baseUrl: 'ftp://example.com' } } })).toThrow(/baseUrl/u)
    expect(() => resolveConfig({ tts: { minimax: { apiKeyEnv: 'not a name' } } })).toThrow(/apiKeyEnv/u)
    expect(() => resolveConfig({ autoReply: { maxChars: 0 } })).toThrow(/maxChars/u)
    expect(() => resolveConfig({ maxSpeakChars: 0 })).toThrow(/maxSpeakChars/u)
  })

  it('expands ~ in the credentials path and keeps "" as "no file"', () => {
    const home = resolveConfig({ tts: { minimax: { credentialsFile: '~/.dsh/.credentials.yaml' } } })
    expect(home.minimaxCredentialsFile?.startsWith('/')).toBe(true)
    expect(home.minimaxCredentialsFile?.endsWith('/.dsh/.credentials.yaml')).toBe(true)
    expect(resolveConfig({ tts: { minimax: { credentialsFile: '' } } }).minimaxCredentialsFile).toBeNull()
  })

  it('resolves export and announcement switches', () => {
    expect(resolveConfig({ tts: { export: { enabled: true } } }).ttsExportEnabled).toBe(true)
    expect(resolveConfig({ announce: { enabled: false } }).announceEnabled).toBe(false)
    expect(resolveConfig({ autoReply: { enabled: false } }).autoReplyEnabled).toBe(false)
  })
})
