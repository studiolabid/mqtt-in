/**
 * File primitives of the JSON storage: reads that ride out a short lock (antivirus, backup or
 * sync tools) and atomic writes (`<file>.tmp`, fsync, rename).
 */
import {
  closeSync,
  copyFileSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { errorCode } from '../../utils/errors'

/** What reading a text file gave: its content, no file at all, or an error other than ENOENT. */
export type ReadOutcome =
  { kind: 'ok'; text: string } | { kind: 'missing' } | { kind: 'failed'; error: unknown }

export interface ReadRetry {
  /** Extra attempts after a failed read (ENOENT is final at once). */
  retries: number
  /** Pause before each extra attempt, in ms. It blocks the thread: startup only. */
  delayMs: number
}

const pause = new Int32Array(new SharedArrayBuffer(4))

/** Blocks the thread for `ms` (the pause between two read attempts). */
function sleepSync(ms: number): void {
  if (ms > 0) Atomics.wait(pause, 0, 0, ms)
}

/** Reads a UTF-8 file; a read error other than ENOENT is retried `retry.retries` times. */
export function readTextFile(
  path: string,
  retry: ReadRetry = { retries: 0, delayMs: 0 }
): ReadOutcome {
  for (let attempt = 0; ; attempt++) {
    try {
      return { kind: 'ok', text: readFileSync(path, 'utf8') }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { kind: 'missing' }
      if (attempt >= retry.retries) return { kind: 'failed', error }
      sleepSync(retry.delayMs)
    }
  }
}

/**
 * Writes `text` to `<path>.tmp`, flushes it to disk (a power loss must never leave an empty or
 * partial file), then renames it over `path`. When the rename fails (Windows: the target can be
 * locked for a moment by an antivirus or indexer), the temporary file is copied over the target
 * instead: not atomic, but better than losing the change; `onRenameFailed` is told why.
 */
export function writeTextFileAtomic(
  path: string,
  text: string,
  onRenameFailed?: (error: unknown) => void
): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  // Owner-only on POSIX: the files hold credentials (sealed when the OS supports it).
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(tmp, path)
  } catch (error) {
    onRenameFailed?.(error)
    copyFileSync(tmp, path)
    try {
      unlinkSync(tmp)
    } catch {
      // A stale .tmp file is harmless; it is overwritten by the next write.
    }
  }
}

/**
 * Moves `path` to `target` (a copy when it cannot be renamed, so the content is kept either way).
 * Returns false when neither worked.
 */
export function moveFileAside(path: string, target: string): boolean {
  try {
    renameSync(path, target)
    return true
  } catch {
    try {
      copyFileSync(path, target)
      return true
    } catch {
      return false
    }
  }
}

/** `2026-11-08T03-04-05-123Z` — a timestamp that is valid in file names on every OS. */
export function fileStamp(at: number): string {
  return new Date(at).toISOString().replace(/[:.]/g, '-')
}
