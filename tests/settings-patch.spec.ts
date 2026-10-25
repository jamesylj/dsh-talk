/**
 * Settings write-back: validation, merge, YAML rendering and the append with a
 * timestamped backup.
 *
 * @module dsh-talk/test/settings-patch.spec
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendSettingsFragment,
  mergeTalkRowConfig,
  renderSettingsFragment,
  validateSettingsInput,
  yamlScalar,
} from '../src/settings-patch.ts'

describe('validateSettingsInput', () => {
  it('accepts the three editable fields', () => {
    expect(validateSettingsInput({ engine: 'mlx', voiceId: 'Chinese (Mandarin)_Gentleman', autoReplyEnabled: false })).toEqual({
      ok: true,
      settings: { engine: 'mlx', voiceId: 'Chinese (Mandarin)_Gentleman', autoReplyEnabled: false },
    })
  })

  it('rejects an unknown engine, a blank voice and a non-boolean switch', () => {
    expect(validateSettingsInput({ engine: 'piper' }).ok).toBe(false)
    expect(validateSettingsInput({ voiceId: '  ' }).ok).toBe(false)
    expect(validateSettingsInput({ autoReplyEnabled: 'yes' }).ok).toBe(false)
    expect(validateSettingsInput('nope').ok).toBe(false)
  })
})

describe('mergeTalkRowConfig', () => {
  it('merges over the raw row without dropping hand-authored keys', () => {
    const merged = mergeTalkRowConfig(
      { tts: { minimax: { apiKeyEnv: 'MINIMAX_CN_API_KEY' }, mlx: { refAudio: '/tmp/ref.wav' } }, autoReply: { maxChars: 5000 } },
      { engine: 'mlx', voiceId: 'voice-x', autoReplyEnabled: false },
    )
    expect(merged['tts']).toMatchObject({ engine: 'mlx', minimax: { voiceId: 'voice-x', apiKeyEnv: 'MINIMAX_CN_API_KEY' }, mlx: { refAudio: '/tmp/ref.wav' } })
    expect(merged['autoReply']).toEqual({ maxChars: 5000, enabled: false })
  })
})

describe('renderSettingsFragment + appendSettingsFragment', () => {
  it('renders one append-only row operation with the merged config', () => {
    const fragment = renderSettingsFragment(mergeTalkRowConfig(undefined, { engine: 'mlx', autoReplyEnabled: true }))
    expect(fragment).toContain('dsh-talk: settings applied by the panel')
    expect(fragment).toContain('- id: talk')
    expect(fragment).toContain('name: dsh-talk')
    expect(fragment).toContain('engine: mlx')
    expect(fragment).toContain('enabled: true')
  })

  it('appends with a backup and keeps the previous bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-talk-patch-test-'))
    try {
      const file = join(dir, 'cordis.patch.yml')
      await writeFile(file, '# header\n[]\n', 'utf8')
      const { bytes } = await appendSettingsFragment(file, '- id: talk\n  config: {}', 3)
      expect(bytes).toBeGreaterThan(0)
      const content = await readFile(file, 'utf8')
      expect(content).toContain('# header')
      expect(content).toContain('- id: talk')
      const names = await import('node:fs/promises').then(fs => fs.readdir(dir))
      expect(names.some(name => name.includes('.bak-'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('yamlScalar', () => {
  it('keeps plain scalars plain and quotes reserved words', () => {
    expect(yamlScalar('minimax')).toBe('minimax')
    expect(yamlScalar('true')).toBe("'true'")
    expect(yamlScalar("it's")).toBe("'it''s'")
  })
})
