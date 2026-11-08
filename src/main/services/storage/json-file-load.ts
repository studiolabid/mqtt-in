/**
 * The startup half of `JsonFile`: reads the file and decides what to use when it is missing,
 * unreadable or corrupt. A corrupt file is moved aside and the last good copy
 * (`<name>.bak.json`, refreshed after every successful load) is used when it parses.
 */
import { errorMessage } from '../../utils/errors'
import { stripBom } from '../../utils/text'
import { moveFileAside, type ReadRetry, readTextFile, writeTextFileAtomic } from './atomic-file'

export type LoadOutcome<T> =
  /** No file yet (first run). */
  | { kind: 'missing' }
  /** The file exists but could not be read, even after the retries. */
  | { kind: 'unreadable'; error: unknown }
  | { kind: 'loaded'; value: T }
  /** The file was corrupt (`moved`: where it was set aside); the last good copy is `text`. */
  | { kind: 'restored'; value: T; text: string; reason: string; moved: string | null }
  /** The file was corrupt and no usable copy exists. */
  | { kind: 'corrupt'; reason: string; moved: string | null }

export interface LoadRequest<T> {
  path: string
  /** The last good copy; `null` = no backup is kept for this file. */
  backupPath: string | null
  /** Where a corrupt file is moved (`<name>.corrupt-<timestamp>.json`). */
  corruptPath: string
  /** Converts the raw JSON into `T`; throwing means the content is corrupt. */
  parse?: (raw: unknown) => T
  retry: ReadRetry
  warn: (message: string) => void
}

function parseText<T>(text: string, parse?: (raw: unknown) => T): T {
  const raw: unknown = JSON.parse(stripBom(text))
  return parse ? parse(raw) : (raw as T)
}

/** Keeps `text` (it just loaded successfully) as the last good copy, unless it already is. */
function refreshBackup(backupPath: string, text: string, warn: (message: string) => void): void {
  const current = readTextFile(backupPath)
  if (current.kind === 'ok' && current.text === text) return
  try {
    writeTextFileAtomic(backupPath, text)
  } catch (err) {
    warn(`[storage] Cannot write ${backupPath}: ${errorMessage(err)}`)
  }
}

function readBackup<T>(request: LoadRequest<T>): { value: T; text: string } | null {
  if (request.backupPath === null) return null
  const read = readTextFile(request.backupPath)
  if (read.kind !== 'ok') return null
  try {
    return { value: parseText(read.text, request.parse), text: read.text }
  } catch (err) {
    request.warn(`[storage] ${request.backupPath} is not usable either: ${errorMessage(err)}`)
    return null
  }
}

/** Reads and parses the file (see `LoadOutcome`). Never throws. */
export function loadJsonFile<T>(request: LoadRequest<T>): LoadOutcome<T> {
  const read = readTextFile(request.path, request.retry)
  if (read.kind === 'missing') return { kind: 'missing' }
  if (read.kind === 'failed') return { kind: 'unreadable', error: read.error }
  let value: T
  try {
    value = parseText(read.text, request.parse)
  } catch (err) {
    const reason = errorMessage(err)
    const moved = moveFileAside(request.path, request.corruptPath) ? request.corruptPath : null
    const restored = readBackup(request)
    request.warn(
      `[storage] ${request.path} is corrupt (${reason}); ` +
        (moved ? `moved to ${moved}, ` : 'cannot move it aside, ') +
        (restored ? `restored ${request.backupPath}` : 'using defaults')
    )
    return restored
      ? { kind: 'restored', ...restored, reason, moved }
      : { kind: 'corrupt', reason, moved }
  }
  if (request.backupPath !== null) refreshBackup(request.backupPath, read.text, request.warn)
  return { kind: 'loaded', value }
}
