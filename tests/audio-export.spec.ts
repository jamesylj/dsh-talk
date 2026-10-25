/**
 * Audio export: naming, directory resolution, the disabled default, pruning
 * bounds and the never-throw contract.
 *
 * @module dsh-talk/test/audio-export.spec
 */

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXPORT_FILE_PATTERN,
  exportFileName,
  exportSynthesizedAudio,
  pruneExports,
  resolveExportDir,
  selectPrunableExports,
  type ExportPolicy,
} from '../src/audio-export.ts'

const STAMP = new Date('2026-10-12T15:30:12.345Z')
const TOKEN = '3f9a1c7d-0000-4000-8000-000000000000'
const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-talk-export-test-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('exportFileName', () => {
  it('names minimax output .mp3 and mlx output .wav', () => {
    const mp3 = exportFileName('minimax', STAMP, TOKEN)
    const wav = exportFileName('mlx', STAMP, TOKEN)
    expect(mp3).toBe('speech-20261012T153012Z-3f9a1c7d.mp3')
    expect(wav).toBe('speech-20261012T153012Z-3f9a1c7d.wav')
    expect(EXPORT_FILE_PATTERN.test(mp3)).toBe(true)
    expect(EXPORT_FILE_PATTERN.test(wav)).toBe(true)
  })

  it('pads a short token and never uses the spoken text', () => {
    expect(exportFileName('minimax', new Date(0), 'ab')).toBe('speech-19700101T000000Z-ab000000.mp3')
  })
})

describe('resolveExportDir', () => {
  it('resolves empty to the plugin directory under home', () => {
    expect(resolveExportDir('', '/Users/example')).toBe('/Users/example/.dsh-talk/audio')
  })

  it('expands ~ and resolves a relative path under home', () => {
    expect(resolveExportDir('~/voice', '/Users/example')).toBe('/Users/example/voice')
    expect(resolveExportDir('voice/out', '/Users/example')).toBe('/Users/example/voice/out')
  })

  it('keeps an absolute path', () => {
    expect(resolveExportDir('/tmp/x', '/Users/example')).toBe('/tmp/x')
  })
})

describe('exportSynthesizedAudio', () => {
  const policy = (dir: string, enabled: boolean): ExportPolicy => ({ enabled, dir, maxFiles: 20, maxAgeMinutes: 1_440 })

  it('reports disabled without writing anything by default', async () => {
    const dir = await tempDir()
    const outcome = await exportSynthesizedAudio(policy(dir, false), 'minimax', TOKEN, new Uint8Array([1]))
    expect(outcome.audioExport).toBe('disabled')
    expect(await readdir(dir)).toEqual([])
  })

  it('writes the file and returns its absolute path', async () => {
    const dir = await tempDir()
    const outcome = await exportSynthesizedAudio(policy(dir, true), 'minimax', TOKEN, new Uint8Array([1, 2, 3]), STAMP)
    expect(outcome.audioExport).toBe('file')
    expect(outcome.audioPath).toBe(join(dir, 'speech-20261012T153012Z-3f9a1c7d.mp3'))
    expect(await readdir(dir)).toHaveLength(1)
  })

  it('never throws on a bad directory', async () => {
    const parent = await tempDir()
    const blocker = join(parent, 'blocker')
    await writeFile(blocker, 'x')
    const outcome = await exportSynthesizedAudio(policy(join(blocker, 'sub'), true), 'mlx', TOKEN, new Uint8Array([1]))
    expect(outcome.audioExport).toBe('failed')
    expect(outcome.exportNote).toMatch(/failed/u)
  })
})

describe('selectPrunableExports', () => {
  const now = 1_000_000_000_000
  const policy = { maxFiles: 2, maxAgeMinutes: 60 }

  it('keeps the newest maxFiles files and never the just-written one', () => {
    const entries = [
      { name: 'speech-20260101T000000Z-aaaaaaaa.mp3', mtimeMs: now - 4 * 60_000 },
      { name: 'speech-20260101T000000Z-bbbbbbbb.mp3', mtimeMs: now - 3 * 60_000 },
      { name: 'speech-20260101T000000Z-cccccccc.mp3', mtimeMs: now - 2 * 60_000 },
      { name: 'speech-20260101T000000Z-dddddddd.mp3', mtimeMs: now - 1 * 60_000 },
    ]
    expect([...selectPrunableExports(entries, ['speech-20260101T000000Z-dddddddd.mp3'], policy, now)].sort())
      .toEqual(['speech-20260101T000000Z-aaaaaaaa.mp3', 'speech-20260101T000000Z-bbbbbbbb.mp3'].sort())
  })

  it('prunes files older than the age bound', () => {
    const entries = [{ name: 'speech-20260101T000000Z-aaaaaaaa.mp3', mtimeMs: now - 61 * 60_000 }]
    expect(selectPrunableExports(entries, [], policy, now)).toEqual([entries[0]?.name])
  })

  it('pruneExports only removes files it names', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'keep.txt'), 'x')
    await writeFile(join(dir, 'speech-20200101T000000Z-aaaaaaaa.mp3'), 'x')
    const removed = await pruneExports(dir, [], { maxFiles: 0, maxAgeMinutes: 1 }, now)
    expect(removed).toBe(1)
    expect(await readdir(dir)).toEqual(['keep.txt'])
  })
})
