/**
 * `<userData>/logs/main.log`: what went wrong in the main process (uncaught exceptions, unhandled
 * rejections, crashed renderer and child processes), kept for bug reports instead of showing users
 * a stack trace. Written synchronously (the process may be in a bad state) and size-capped: once
 * it would pass `MAIN_LOG_MAX_BYTES`, the file moves to `main.old.log` and a new one starts.
 * Node only (no electron import), so it is unit-tested directly.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const MAIN_LOG_MAX_BYTES = 1024 * 1024

/** One entry is cut after this many characters (a huge error message must not fill the log). */
const MAX_ENTRY_CHARS = 16_000

export interface MainLog {
  /** Absolute path of `main.log`. */
  readonly path: string
  /** Appends `<ISO time> [<kind>] <detail>`; never throws. */
  append(kind: string, detail: unknown): void
}

export interface MainLogOptions {
  maxBytes?: number
  now?: () => number
}

function describe(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? `${detail.name}: ${detail.message}`
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail) ?? String(detail)
  } catch {
    return String(detail)
  }
}

/** The main log in `dir` (created on the first entry). */
export function createMainLog(dir: string, options: MainLogOptions = {}): MainLog {
  const path = join(dir, 'main.log')
  const maxBytes = options.maxBytes ?? MAIN_LOG_MAX_BYTES
  const now = options.now ?? Date.now
  return {
    path,
    append(kind, detail) {
      const time = new Date(now()).toISOString()
      const line = `${time} [${kind}] ${describe(detail).slice(0, MAX_ENTRY_CHARS)}\n`
      try {
        mkdirSync(dir, { recursive: true })
        let size = 0
        try {
          size = statSync(path).size
        } catch {
          // No log yet.
        }
        if (size > 0 && size + Buffer.byteLength(line) > maxBytes) {
          renameSync(path, join(dir, 'main.old.log'))
        }
        appendFileSync(path, line, 'utf8')
      } catch (err) {
        console.error('[app] Cannot write the main log:', err)
      }
    }
  }
}

/** The part of `process` used here (a fake emitter in tests). */
export type ProcessEvents = Pick<NodeJS.Process, 'on'>

/**
 * Logs uncaught exceptions and unhandled rejections (console and main log) and keeps the app
 * running. With a handler installed, Electron no longer shows its 'A JavaScript error occurred
 * in the main process' box with the stack trace (in automation runs neither).
 */
export function logUncaughtErrors(log: MainLog, target: ProcessEvents = process): void {
  target.on('uncaughtException', (error) => {
    console.error('[app] Uncaught exception:', error)
    log.append('uncaughtException', error)
  })
  target.on('unhandledRejection', (reason) => {
    console.error('[app] Unhandled rejection:', reason)
    log.append('unhandledRejection', reason)
  })
}
