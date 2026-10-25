/**
 * Config contract: the Schemastery schema fills leaf defaults on an empty
 * input, rejects out-of-range values loudly, and `resolveConfig` re-judges
 * every default for programmatic mounts plus the cross-field engine checks.
 * The auto-read knobs resolve into the `autoReply*` policy fields: on by
 * default, capped at 1..100000, with at least one trigger reason.
 *
 * @module dsh-talk/test/config.spec
 */

import { describe, expect, it } from 'vitest'
import { Config, resolveConfig, MAX_AUTO_REPLY_MAX_CHARS, MAX_RECORD_SECONDS } from '../src/config.ts'
import { resolveSttEngine, resolveTtsEngine } from '../src/service.ts'

describe('Config schema', () => {
  it('fills every leaf default on an empty input', () => {
    const normalized = Config({}) as {
      record: { enabled: boolean }
      stt: { engine: string; language: string; interim: boolean; silenceFinaliseMs: number }
      tts: { engine: string; rate: number }
      announce: { enabled: boolean; messages: { turnEnd: string } }
      autoReply: { enabled: boolean; maxChars: number; skipIfToolSpoke: boolean; skipSubagents: boolean; reasons: string[] }
    }
    expect(normalized.record.enabled).toBe(true)
    expect(normalized.stt.engine).toBe('auto')
    expect(normalized.stt.language).toBe('auto')
    expect(normalized.stt.interim).toBe(true)
    expect(normalized.stt.silenceFinaliseMs).toBe(4000)
    expect(normalized.tts.engine).toBe('auto')
    expect(normalized.tts.rate).toBe(0)
    expect(normalized.announce.enabled).toBe(true)
    expect(normalized.announce.messages.turnEnd).toBe('Turn complete.')
    // Auto-read is on by default: the assistant's final reply replaces the
    // generic announcement whenever one can be read.
    expect(normalized.autoReply.enabled).toBe(true)
    expect(normalized.autoReply.maxChars).toBe(600)
    expect(normalized.autoReply.skipIfToolSpoke).toBe(true)
    expect(normalized.autoReply.skipSubagents).toBe(true)
    expect(normalized.autoReply.reasons).toEqual(['completed', 'max-tokens'])
  })

  it('keeps nested defaults when only a leaf is overridden', () => {
    const normalized = Config({ record: { autoSubmit: true }, autoReply: { maxChars: 120 } }) as {
      record: { autoSubmit: boolean; enabled: boolean }
      stt: { interim: boolean }
      autoReply: { enabled: boolean; maxChars: number; reasons: string[] }
    }
    expect(normalized.record.autoSubmit).toBe(true)
    expect(normalized.record.enabled).toBe(true)
    expect(normalized.stt.interim).toBe(true)
    expect(normalized.autoReply.maxChars).toBe(120)
    expect(normalized.autoReply.enabled).toBe(true)
    expect(normalized.autoReply.reasons).toEqual(['completed', 'max-tokens'])
  })

  it('rejects a recording cap above the ceiling', () => {
    expect(() => Config({ record: { maxSeconds: MAX_RECORD_SECONDS + 1 } })).toThrow()
  })

  it('rejects an unknown STT engine', () => {
    expect(() => Config({ stt: { engine: 'watson' as 'web' } })).toThrow()
  })

  it('rejects an auto-read cap outside 1..100000 and an unknown reason', () => {
    expect(() => Config({ autoReply: { maxChars: MAX_AUTO_REPLY_MAX_CHARS + 1 } })).toThrow()
    expect(() => Config({ autoReply: { maxChars: 0 } })).toThrow()
    expect(() => Config({ autoReply: { reasons: ['sometimes' as 'completed'] } })).toThrow()
  })
})

describe('resolveConfig', () => {
  it('re-validates bounds for a programmatic mount', () => {
    expect(() => resolveConfig({ maxSpeakChars: 0 })).toThrow(/maxSpeakChars/u)
    expect(() => resolveConfig({ stt: { silenceFinaliseMs: 499 } })).toThrow(/silenceFinaliseMs/u)
    expect(() => resolveConfig({ stt: { silenceFinaliseMs: 15_001 } })).toThrow(/silenceFinaliseMs/u)
  })

  it('fails loud when funasr is selected without an endpoint', () => {
    expect(() => resolveConfig({ stt: { engine: 'funasr' } })).toThrow(/funasr/u)
  })

  it('fails loud when piper is selected without a model', () => {
    expect(() => resolveConfig({ tts: { engine: 'piper' } })).toThrow(/piper/u)
  })

  it('accepts the auto engine without any local model', () => {
    const resolved = resolveConfig({})
    expect(resolved.sttEngine).toBe('auto')
    expect(resolved.ttsEngine).toBe('auto')
  })

  it('keeps the default announce messages', () => {
    const resolved = resolveConfig({})
    expect(resolved.messageApproval).toBe('Approval required.')
  })

  it('resolves the VAD defaults and rejects an out-of-range silence window', () => {
    const resolved = resolveConfig({})
    expect(resolved.vadEnabled).toBe(true)
    expect(resolved.vadSilenceMs).toBe(1_500)
    expect(resolved.vadEnergyThreshold).toBe(0.01)
    expect(() => resolveConfig({ record: { vad: { silenceMs: 10 } } })).toThrow(/silenceMs/u)
  })

  it('resolves the auto-read defaults: enabled, 600 chars, both guards on, two reasons', () => {
    const resolved = resolveConfig({})
    expect(resolved.autoReplyEnabled).toBe(true)
    expect(resolved.autoReplyMaxChars).toBe(600)
    expect(resolved.autoReplySkipIfToolSpoke).toBe(true)
    expect(resolved.autoReplySkipSubagents).toBe(true)
    expect(resolved.autoReplyReasons).toEqual(['completed', 'max-tokens'])
  })

  it('resolves explicit auto-read overrides, including a narrowed reason list', () => {
    const resolved = resolveConfig({
      autoReply: { enabled: false, maxChars: 120, skipIfToolSpoke: false, skipSubagents: false, reasons: ['max-tokens'] },
    })
    expect(resolved.autoReplyEnabled).toBe(false)
    expect(resolved.autoReplyMaxChars).toBe(120)
    expect(resolved.autoReplySkipIfToolSpoke).toBe(false)
    expect(resolved.autoReplySkipSubagents).toBe(false)
    expect(resolved.autoReplyReasons).toEqual(['max-tokens'])
  })

  it('re-validates the auto-read bounds and rejects an empty or unknown reason list', () => {
    expect(() => resolveConfig({ autoReply: { maxChars: 0 } })).toThrow(/autoReply\.maxChars/u)
    expect(() => resolveConfig({ autoReply: { maxChars: MAX_AUTO_REPLY_MAX_CHARS + 1 } })).toThrow(/autoReply\.maxChars/u)
    expect(() => resolveConfig({ autoReply: { reasons: [] } })).toThrow(/at least one reason/u)
    expect(() => resolveConfig({ autoReply: { reasons: ['sometimes' as 'completed'] } })).toThrow(/autoReply\.reasons/u)
  })

  it('treats empty optional engine paths as not configured, so auto picks a usable engine', () => {
    const resolved = resolveConfig({})
    // Empty schema defaults must not read as "configured" (they used to make
    // auto select piper/whisper/funasr and fail at the first utterance).
    expect(resolved.piperModelPath).toBeNull()
    expect(resolved.whisperModelPath).toBeNull()
    expect(resolved.funasrUrl).toBeNull()
    expect(resolved.ttsVoice).toBeNull()
    expect(resolved.browserVoiceName).toBeNull()
    expect(resolveTtsEngine(undefined, resolved)).toBe('edge-tts')
    expect(resolveSttEngine(resolved)).toBe('web')
    // An explicitly selected local engine still fails loud on a blank path.
    expect(() => resolveConfig({ tts: { engine: 'piper', piper: { modelPath: '' } } })).toThrow(/piper/u)
    expect(() => resolveConfig({ stt: { engine: 'whisper', whisper: { modelPath: '' } } })).toThrow(/whisper/u)
    expect(() => resolveConfig({ stt: { engine: 'funasr', funasr: { url: '' } } })).toThrow(/funasr/u)
  })

  it('resolves the macOS say engine defaults, bounds, and explicit selection', () => {
    const resolved = resolveConfig({})
    expect(resolved.macosCommand).toBe('/usr/bin/say')
    expect(resolved.macosVoice).toBe('Eddy (中文（中国大陆）)')
    expect(resolved.macosRate).toBe(175)
    // Explicit selection resolves to the macOS engine; `auto` order is unchanged.
    expect(resolveTtsEngine('macos', resolved)).toBe('macos')
    expect(resolveTtsEngine(undefined, resolved)).toBe('edge-tts')
    // The defaults are addressable: selecting the engine needs no extra config.
    expect(() => resolveConfig({ tts: { engine: 'macos' } })).not.toThrow()
    // Bounds and non-empty checks are re-judged by the explicit resolve step.
    expect(() => resolveConfig({ tts: { macos: { rate: 59 } } })).toThrow(/macos\.rate/u)
    expect(() => resolveConfig({ tts: { macos: { rate: 401 } } })).toThrow(/macos\.rate/u)
    expect(() => resolveConfig({ tts: { macos: { command: '' } } })).toThrow(/macos\.command/u)
    expect(() => resolveConfig({ tts: { macos: { voice: '   ' } } })).toThrow(/macos\.voice/u)
    const overridden = resolveConfig({ tts: { macos: { command: '/usr/bin/say', voice: 'Tingting', rate: 200 } } })
    expect(overridden.macosVoice).toBe('Tingting')
    expect(overridden.macosRate).toBe(200)
  })

  it('resolves the mlx engine defaults and bounds', () => {
    const resolved = resolveConfig({ tts: { engine: 'mlx' } })
    expect(resolved.mlxCommand).toContain('.dsh-talk/mlx-tts-venv/bin/python')
    expect(resolved.mlxModel).toContain('qwen3-tts-0.6b-4bit')
    expect(resolved.mlxVoice).toBe('Vivian')
    expect(resolved.mlxLanguage).toBe('Chinese')
    expect(resolved.mlxChunkChars).toBe(100)
    expect(resolved.mlxPlayer).toBe('/usr/bin/afplay')
    expect(resolved.mlxScript).toBeNull()
    expect(resolveTtsEngine('mlx', resolved)).toBe('mlx')
    expect(() => resolveConfig({ tts: { mlx: { chunkChars: 10 } } })).toThrow(/mlx\.chunkChars/u)
    expect(() => resolveConfig({ tts: { mlx: { chunkChars: 600 } } })).toThrow(/mlx\.chunkChars/u)
    expect(() => resolveConfig({ tts: { mlx: { voice: '  ' } } })).toThrow(/mlx\.voice/u)
    expect(() => resolveConfig({ tts: { mlx: { model: '' } } })).toThrow(/mlx\.model/u)
  })
})

