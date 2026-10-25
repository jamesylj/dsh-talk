/**
 * Config resolution: MiniMax-only defaults, bounds and credential-path handling.
 *
 * @module dsh-talk/test/config.spec
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_REPLY_MAX_CHARS,
  DEFAULT_MAX_SPEAK_CHARS,
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_MODEL,
  DEFAULT_MINIMAX_VOICE,
  Config,
  resolveConfig,
} from '../src/config.ts'

describe('resolveConfig', () => {
  it('resolves every default', () => {
    const resolved = resolveConfig({})
    expect(resolved).toMatchObject({
      minimaxApiKeyEnv: 'MINIMAX_CN_API_KEY',
      minimaxBaseUrl: DEFAULT_MINIMAX_BASE_URL,
      minimaxModel: DEFAULT_MINIMAX_MODEL,
      minimaxVoiceId: DEFAULT_MINIMAX_VOICE,
      minimaxChunkChars: 2000,
      minimaxRequestTimeoutMs: 120_000,
      announceEnabled: true,
      autoReplyEnabled: true,
      autoReplyMaxChars: DEFAULT_AUTO_REPLY_MAX_CHARS,
      maxSpeakChars: DEFAULT_MAX_SPEAK_CHARS,
    })
    expect(resolved.minimaxCredentialsFile).toBe(join(homedir(), '.dsh', '.credentials.yaml'))
  })

  it('accepts a full MiniMax override and expands ~ in the credential path', () => {
    const resolved = resolveConfig({
      tts: { minimax: { apiKeyEnv: 'MY_KEY', credentialsFile: '~/creds.yaml', voiceId: 'female-yujie', chunkChars: 3000 } },
      announce: { enabled: false },
      autoReply: { enabled: false, maxChars: 5000 },
      maxSpeakChars: 9000,
    })
    expect(resolved.minimaxApiKeyEnv).toBe('MY_KEY')
    expect(resolved.minimaxCredentialsFile).toBe(join(homedir(), 'creds.yaml'))
    expect(resolved.minimaxVoiceId).toBe('female-yujie')
    expect(resolved.minimaxChunkChars).toBe(3000)
    expect(resolved.announceEnabled).toBe(false)
    expect(resolved.autoReplyEnabled).toBe(false)
    expect(resolved.autoReplyMaxChars).toBe(5000)
    expect(resolved.maxSpeakChars).toBe(9000)
  })

  it('disables the credential-file fallback with an empty path', () => {
    expect(resolveConfig({ tts: { minimax: { credentialsFile: '' } } }).minimaxCredentialsFile).toBeNull()
  })

  it('rejects bad values loudly', () => {
    expect(() => resolveConfig({ tts: { minimax: { apiKeyEnv: 'not-a-shell-name' } } })).toThrow(/apiKeyEnv/)
    expect(() => resolveConfig({ tts: { minimax: { baseUrl: 'ftp://x' } } })).toThrow(/baseUrl/)
    expect(() => resolveConfig({ tts: { minimax: { chunkChars: 10 } } })).toThrow(/chunkChars/)
    expect(() => resolveConfig({ tts: { minimax: { requestTimeoutMs: 1 } } })).toThrow(/requestTimeoutMs/)
    expect(() => resolveConfig({ autoReply: { maxChars: 0 } })).toThrow(/autoReply.maxChars/)
    expect(() => resolveConfig({ maxSpeakChars: 0 })).toThrow(/maxSpeakChars/)
  })

  it('exposes one Schemastery schema carrying only MiniMax and the behaviour switches', () => {
    const schema = Config({})
    expect(schema).toMatchObject({ maxSpeakChars: DEFAULT_MAX_SPEAK_CHARS })
  })
})
