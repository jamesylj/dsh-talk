/**
 * Engine command builders: argv shape, rate/length-scale mapping, whisper
 * language handling, and the abort/failure classification contract.
 *
 * @module dsh-talk/test/engine.spec
 */

import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { edgeTtsArgv, macosRateWpm, macosSaySpec, parseMacosVoiceList, piperSpec, whisperArgv } from '../src/engine.ts'

describe('edgeTtsArgv', () => {
  it('builds the full edge-tts argv with a positive rate', () => {
    const resolved = resolveConfig({ tts: { rate: 20, edgeTts: { voice: 'en-US-AriaNeural' } } })
    const argv = edgeTtsArgv(resolved, 'hello', 'C:\\tmp\\out.mp3')
    expect(argv).toEqual([
      'edge-tts',
      '--voice', 'en-US-AriaNeural',
      '--rate=+20%',
      '--text', 'hello',
      '--write-media', 'C:\\tmp\\out.mp3',
    ])
  })

  it('uses the resolved tts voice override', () => {
    const resolved = resolveConfig({ tts: { voice: 'zh-CN-XiaoxiaoNeural' } })
    const argv = edgeTtsArgv(resolved, 'hi', '/tmp/out.mp3')
    expect(argv[2]).toBe('zh-CN-XiaoxiaoNeural')
  })
})

describe('piperSpec', () => {
  it('maps a positive rate onto a shorter length scale', () => {
    const resolved = resolveConfig({ tts: { rate: 40, piper: { modelPath: 'en.onnx' } } })
    const spec = piperSpec(resolved, '/tmp/out.wav')
    expect(spec.argv[0]).toBe('piper')
    expect(spec.argv).toContain('--model')
    expect(spec.argv).toContain('en.onnx')
    expect(spec.argv).toContain('--length_scale')
    expect(Number(spec.argv[spec.argv.indexOf('--length_scale') + 1])).toBeLessThan(1)
    expect(spec.stdin).toBe('')
  })
})

describe('whisperArgv', () => {
  it('passes the language tag when configured', () => {
    const resolved = resolveConfig({ stt: { whisper: { modelPath: 'ggml.bin', language: 'en' } } })
    const argv = whisperArgv(resolved, '/tmp/in.wav', '/tmp/base', 'auto')
    expect(argv[0]).toBe('whisper-cli')
    expect(argv).toContain('--language')
    expect(argv).toContain('en')
  })

  it('omits the language flag for auto', () => {
    const resolved = resolveConfig({ stt: { whisper: { modelPath: 'ggml.bin' } } })
    const argv = whisperArgv(resolved, '/tmp/in.wav', '/tmp/base', 'auto')
    expect(argv).not.toContain('--language')
  })
})

describe('macosSaySpec', () => {
  it('builds the say argv for a WAVE file and passes the text on stdin', () => {
    const resolved = resolveConfig({ tts: { rate: 20, macos: { voice: 'Tingting' } } })
    const spec = macosSaySpec(resolved, '你好', '/tmp/out.wav')
    expect(spec.argv).toEqual([
      '/usr/bin/say',
      '-v', 'Tingting',
      '-r', '210',
      '-o', '/tmp/out.wav',
      '--file-format=WAVE',
      '--data-format=LEI16@22050',
      '-f', '-',
    ])
    expect(spec.stdin).toBe('你好')
  })

  it('defaults to the Eddy zh_CN voice and the 175 wpm anchor', () => {
    const spec = macosSaySpec(resolveConfig({}), 'hi', '/tmp/out.wav')
    expect(spec.argv).toContain('Eddy (中文（中国大陆）)')
    expect(spec.argv[spec.argv.indexOf('-r') + 1]).toBe('175')
  })

  it('lets a per-call voice override win over the configured macOS voice', () => {
    const resolved = resolveConfig({ tts: { macos: { voice: 'Tingting' } } })
    const spec = macosSaySpec(resolved, 'hi', '/tmp/out.wav', 'Meijia')
    expect(spec.argv[spec.argv.indexOf('-v') + 1]).toBe('Meijia')
  })

  it('clamps the mapped words per minute to a rate say accepts', () => {
    expect(macosRateWpm(resolveConfig({ tts: { macos: { rate: 400 }, rate: 50 } }))).toBe(600)
    expect(macosRateWpm(resolveConfig({ tts: { macos: { rate: 60 }, rate: -50 } }))).toBe(40)
    expect(macosRateWpm(resolveConfig({ tts: { macos: { rate: 175 }, rate: -50 } }))).toBe(88)
  })
})

describe('parseMacosVoiceList', () => {
  it('extracts names that contain spaces and CJK parentheses', () => {
    const output = [
      'Albert              en_US    # Hello! My name is Albert.',
      'Eddy (中文（中国大陆）)     zh_CN    # 你好！我叫Eddy。',
      'Grandma (西班牙语（西班牙）) es_ES    # ¡Hola! Me llamo Grandma.',
      'Majed               ar_001   # مرحبًا! اسمي ماجد.',
      'Tingting            zh_CN    # 你好！我叫婷婷。',
      '',
    ].join('\n')
    expect(parseMacosVoiceList(output)).toEqual([
      'Albert',
      'Eddy (中文（中国大陆）)',
      'Grandma (西班牙语（西班牙）)',
      'Majed',
      'Tingting',
    ])
  })
})

