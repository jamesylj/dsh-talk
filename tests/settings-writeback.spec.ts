/**
 * The profile-patch write-back (A7): a settings submission whose MERGED row
 * cannot load must be refused before anything touches the patch layer — the
 * file stays byte-identical and no backup appears — while a row that loads is
 * appended with exactly one backup. The wire validation only inspects the
 * submission itself, so the merged-config check is the layer under test here
 * (`ttsEngine: 'piper'` passes the wire check but needs a configured model).
 * Also covers the auto-reply toggle: the `talk/status` snapshot the panel
 * renders and the `autoReply.enabled` write-back that preserves the row's
 * non-panel `autoReply` keys (e.g. `maxChars`).
 * @module dsh-talk/test/settings-writeback.spec
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mountHarness } from './harness.ts'
import { TALK_STATUS_SCHEMA } from '../src/wire.ts'

/** Run `body` over a fresh throwaway profile directory holding a patch layer. */
async function withProfilePatch(body: (dir: string, file: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-talk-patch-'))
  const file = join(dir, 'cordis.patch.yml')
  await writeFile(file, '# hand-authored profile patch layer\n- insert:\n    - id: talk\n', 'utf8')
  try {
    await body(dir, file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Point the mounted service at `dir` through the loader's `baseUrl` seat. */
async function mountAt(dir: string, config: Record<string, unknown> = {}) {
  const harness = await mountHarness(config)
  ;(harness.ctx as unknown as { baseUrl?: string }).baseUrl = dir
  return harness
}

const backupNames = (names: string[]): string[] => names.filter(name => name.includes('.bak-'))

describe('applySettings profile-patch write-back', () => {
  it('refuses a merged configuration that cannot load, leaving the file and its backups untouched', async () => {
    await withProfilePatch(async (dir, file) => {
      const harness = await mountAt(dir)
      const before = await readFile(file, 'utf8')
      // `piper` passes the wire validation but needs `tts.piper.modelPath`.
      await expect(harness.service.applySettings({ ttsEngine: 'piper' })).rejects.toThrow(/cannot load/)
      expect(await readFile(file, 'utf8')).toBe(before)
      expect(backupNames(await readdir(dir))).toHaveLength(0)
    })
  })

  it('appends the validated fragment and exactly one backup for a configuration that loads', async () => {
    await withProfilePatch(async (dir, file) => {
      const harness = await mountAt(dir)
      const before = await readFile(file, 'utf8')
      const result = await harness.service.applySettings({ ttsEngine: 'browser' })
      expect(result.file).toBe(file)
      const written = await readFile(file, 'utf8')
      // The fragment restates the ROW config (config vocabulary: `tts.engine`),
      // not the panel's flat submission keys, and never rewrites what was there.
      expect(written.startsWith(before)).toBe(true)
      expect(written).toContain('- id: talk')
      expect(written).toContain('  name: dsh-talk')
      expect(written).toMatch(/^ {2}config:$/m)
      expect(written).toMatch(/^ {4}tts:$/m)
      expect(written).toMatch(/^ {6}engine: browser$/m)
      const backups = backupNames(await readdir(dir))
      expect(backups).toHaveLength(1)
      expect(await readFile(join(dir, backups[0]!), 'utf8')).toBe(before)
    })
  })

  it('rejects a malformed submission before touching the file at all', async () => {
    await withProfilePatch(async (dir, file) => {
      const harness = await mountAt(dir)
      const before = await readFile(file, 'utf8')
      await expect(harness.service.applySettings({ sttEngine: 'not-an-engine' } as never)).rejects.toThrow()
      expect(await readFile(file, 'utf8')).toBe(before)
      expect(backupNames(await readdir(dir))).toHaveLength(0)
    })
  })
})

describe('auto-reply settings toggle', () => {
  it('serves the toggle and its cap in the talk/status snapshot the panel renders', async () => {
    const harness = await mountHarness({ autoReply: { enabled: false, maxChars: 120 } })
    const status = harness.service.status()
    expect(status.autoReply).toEqual({ enabled: false, maxChars: 120 })
    // The remote codec validates the snapshot before it leaves the host.
    expect(TALK_STATUS_SCHEMA.safeParse(status).success).toBe(true)
  })

  it('writes autoReply.enabled through applySettings and keeps the row\u2019s other autoReply keys', async () => {
    await withProfilePatch(async (dir, file) => {
      const harness = await mountAt(dir, { autoReply: { maxChars: 120 } })
      await harness.service.applySettings({ autoReplyEnabled: false })
      const written = await readFile(file, 'utf8')
      expect(written).toMatch(/^ {4}autoReply:$/m)
      expect(written).toMatch(/^ {6}enabled: false$/m)
      // The panel did not expose maxChars; the hand-authored value survives.
      expect(written).toMatch(/^ {6}maxChars: 120$/m)
    })
  })

  it('rejects a non-boolean toggle before touching the patch layer', async () => {
    await withProfilePatch(async (dir, file) => {
      const harness = await mountAt(dir)
      const before = await readFile(file, 'utf8')
      await expect(harness.service.applySettings({ autoReplyEnabled: 'yes' } as never)).rejects.toThrow(/autoReplyEnabled/u)
      expect(await readFile(file, 'utf8')).toBe(before)
      expect(backupNames(await readdir(dir))).toHaveLength(0)
    })
  })
})
