/**
 * Best-effort diagnostics log. The plugin has no general logging surface (the
 * host logger output is not persisted), so interactive-only failures — a
 * composer button whose Remote call fails, an engine fallback — are appended to
 * one small bounded file under `~/.dsh-talk/logs/` where a user (or a later
 * debugging session) can read them. Never throws into a speak/play path.
 *
 * @module dsh-talk/diagnostics
 */

import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sanitizeText } from './sanitize.ts'

/** Directory (under the user's home) that holds plugin runtime data. */
const DATA_DIR = '.dsh-talk'

/** Test/internal override for the log directory (absolute path). */
const LOG_DIR_ENV = 'DSH_TALK_LOG_DIR'

/** Diagnostics file name inside {@link DATA_DIR}. */
const LOG_NAME = 'diagnostics.log'

/** Rotate to `<name>.1` once the live file passes this size. */
const MAX_BYTES = 256 * 1024

/** Bound on one logged line (message + detail). */
const MAX_LINE = 2_000

/**
 * Append one diagnostics line, rotating the file when it grew too large.
 * Best-effort: every filesystem failure is swallowed.
 *
 * @param message - short event name (for example `playLatest`).
 * @param detail - optional sanitized context.
 */
export async function appendDiagnostic(message: string, detail?: string): Promise<void> {
  try {
    const dir = logsDirectory()
    const file = join(dir, LOG_NAME)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await rotateIfLarge(file)
    const line = `${new Date().toISOString()} ${sanitizeText(`${message}${detail === undefined ? '' : ` ${detail}`}`, MAX_LINE)}\n`
    await appendFile(file, line, { mode: 0o600 })
  } catch {
    // Diagnostics must never break the feature they instrument.
  }
}

/** Move the live file aside once it exceeds {@link MAX_BYTES} (one generation kept). */
async function rotateIfLarge(file: string): Promise<void> {
  let size = 0
  try {
    size = (await stat(file)).size
  } catch {
    return
  }
  if (size <= MAX_BYTES) return
  try {
    await unlink(`${file}.1`)
  } catch {
    // No previous generation to drop.
  }
  try {
    await rename(file, `${file}.1`)
  } catch {
    // A busy file just keeps appending.
  }
}

/** The directory diagnostics land in (env override honoured for tests). */
export function logsDirectory(): string {
  const override = process.env[LOG_DIR_ENV]
  return override !== undefined && override !== '' ? override : join(homedir(), DATA_DIR, 'logs')
}

/** Absolute path of the diagnostics file (for documentation and tests). */
export function diagnosticsPath(): string {
  return join(logsDirectory(), LOG_NAME)
}

/** Read the current diagnostics file (bounded); empty string when absent. */
export async function readDiagnostics(limit = MAX_LINE * 20): Promise<string> {
  try {
    const text = await readFile(diagnosticsPath(), 'utf8')
    return text.slice(-limit)
  } catch {
    return ''
  }
}

/**
 * Format a caught value for one diagnostics line (sanitized, single line).
 *
 * @param error - the thrown value.
 * @returns a short description.
 */
export function describeError(error: unknown): string {
  return sanitizeText(error instanceof Error ? `${error.name}: ${error.message}` : String(error), MAX_LINE)
}
