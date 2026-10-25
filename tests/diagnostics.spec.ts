/**
 * Diagnostics log: bounded, best-effort, redacted. The file path is
 * overridable so a test never appends to the developer's home.
 *
 * @module dsh-talk/test/diagnostics.spec
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendDiagnostic, describeError, diagnosticsPath, readDiagnostics } from '../src/diagnostics.ts'

let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-talk-diagnostics-'))
  process.env['DSH_TALK_LOG_DIR'] = dir
})

afterAll(async () => {
  delete process.env['DSH_TALK_LOG_DIR']
  await rm(dir, { recursive: true, force: true })
})

describe('appendDiagnostic', () => {
  it('appends one timestamped line under the overridden directory', async () => {
    expect(diagnosticsPath()).toBe(join(dir, 'diagnostics.log'))
    await appendDiagnostic('playLatest', 'unknown session session-x')
    const text = await readFile(diagnosticsPath(), 'utf8')
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    expect(text).toContain('playLatest unknown session session-x')
    expect(await readDiagnostics()).toContain('playLatest')
  })

  it('redacts a credential-shaped detail', async () => {
    await appendDiagnostic('engine', 'request failed with sk-abcdef123456')
    const text = await readFile(diagnosticsPath(), 'utf8')
    expect(text).not.toContain('sk-abcdef123456')
  })
})

describe('describeError', () => {
  it('formats an Error and a raw value as one line', () => {
    expect(describeError(new Error('boom'))).toBe('Error: boom')
    expect(describeError('plain failure')).toBe('plain failure')
  })
})
