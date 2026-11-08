/**
 * A JSON document persisted in one file: loaded synchronously, edited in memory, saved with a
 * debounce and atomically (`writeTextFileAtomic`: tmp file, fsync, rename).
 *
 * A file is never replaced with less than it held, and every problem the user must hear about
 * is reported through `onNotice` (a `StorageNotice`):
 * - a missing file yields the defaults (first run);
 * - a file that exists but cannot be read (locked by an antivirus or sync tool, no permission,
 *   I/O error) is read again a few times; when it still fails, the defaults are used in memory and
 *   writes are blocked for the session (`writeBlocked`): the real file is never touched, changes
 *   go to `<name>.pending.json` instead ('unreadable');
 * - unparsable content (or a `parse` that throws) is moved aside to
 *   `<name>.corrupt-<timestamp>.json`; the last good copy `<name>.bak.json`, refreshed after every
 *   successful load, is restored when it parses ('restored-backup'), the defaults are used
 *   otherwise ('corrupt');
 * - a failed write keeps the change in memory, is retried, and is reported once until a write
 *   succeeds again ('write-failed').
 */
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAME } from '@shared/defaults'
import type { StorageNotice, StorageNoticeKind } from '@shared/models'
import { errorMessage } from '../../utils/errors'
import { fileStamp, writeTextFileAtomic } from './atomic-file'
import { loadJsonFile } from './json-file-load'

export interface JsonFileLogger {
  warn(message: string): void
  error(message: string): void
}

export interface JsonFileOptions {
  /** Delay between the first unsaved change and the write, in ms. Default 300. */
  debounceMs?: number
  /** Indentation of the written JSON. Default 2. */
  indent?: number
  logger?: JsonFileLogger
  /** Receives the problems the user must hear about (`Storage.notices` in the app). */
  onNotice?: (notice: StorageNotice) => void
  /** Keep `<name>.bak.json`, the last copy that loaded successfully. Default true. */
  keepBackup?: boolean
  /** Extra read attempts when the file exists but cannot be read. Default 5. */
  readRetries?: number
  /** Pause before each extra read attempt, in ms (it blocks: startup only). Default 100. */
  readRetryDelayMs?: number
  /** Delay before a failed write is tried again, in ms. Default 5000. */
  writeRetryMs?: number
  /** Clock for notice timestamps and file stamps. Default `Date.now`. */
  now?: () => number
}

type Settings = Required<Omit<JsonFileOptions, 'onNotice' | 'logger'>>

export class JsonFile<T> {
  /** Absolute path of the JSON file. */
  readonly path: string
  /** File name shown to the user, e.g. `connections.json`. */
  readonly fileName: string
  /** `<name>.bak.json`: the last copy that loaded successfully. */
  readonly backupPath: string
  /** `<name>.pending.json`: the session's changes while the real file must not be written. */
  readonly pendingPath: string
  private readonly settings: Settings
  private readonly logger: JsonFileLogger
  private readonly onNotice?: (notice: StorageNotice) => void
  private value: T | undefined
  private loaded = false
  private dirty = false
  private blocked = false
  private failing = false
  private timer: ReturnType<typeof setTimeout> | null = null

  /** @param dir directory of the file (created on first write) — `<userData>/data` in the app. */
  constructor(
    readonly dir: string,
    readonly name: string,
    options: JsonFileOptions = {}
  ) {
    this.fileName = `${name}.json`
    this.path = join(dir, this.fileName)
    this.backupPath = join(dir, `${name}.bak.json`)
    this.pendingPath = join(dir, `${name}.pending.json`)
    this.logger = options.logger ?? console
    this.onNotice = options.onNotice
    this.settings = {
      debounceMs: options.debounceMs ?? 300,
      indent: options.indent ?? 2,
      keepBackup: options.keepBackup ?? true,
      readRetries: options.readRetries ?? 5,
      readRetryDelayMs: options.readRetryDelayMs ?? 100,
      writeRetryMs: options.writeRetryMs ?? 5000,
      now: options.now ?? Date.now
    }
  }

  /**
   * True when the file exists but could not be read by `load()`: it may still hold the user's
   * data, so it is never written in this session.
   */
  get writeBlocked(): boolean {
    return this.blocked
  }

  /**
   * Reads the file (see the module comment for missing, unreadable and corrupt files).
   * @param parse converts the raw JSON into `T` (validation / migration hook); throwing means
   *   the content is corrupt.
   */
  load(defaults: T, parse?: (raw: unknown) => T): T {
    this.loaded = true
    const outcome = loadJsonFile({
      path: this.path,
      backupPath: this.settings.keepBackup ? this.backupPath : null,
      corruptPath: this.stampedPath('corrupt'),
      parse,
      retry: { retries: this.settings.readRetries, delayMs: this.settings.readRetryDelayMs },
      warn: (message) => this.logger.warn(message)
    })
    this.blocked = outcome.kind === 'unreadable'
    this.value = outcome.kind === 'loaded' || outcome.kind === 'restored' ? outcome.value : defaults
    if (outcome.kind === 'unreadable') {
      this.logger.warn(
        `[storage] Cannot read ${this.path}: ${errorMessage(outcome.error)}; ` +
          'it is not written in this session'
      )
      this.notify(
        'unreadable',
        `Could not read ${this.fileName} (file locked or unreadable). Changes are kept in ` +
          `memory and not saved until ${APP_NAME} restarts.`,
        this.path
      )
    } else if (outcome.kind === 'corrupt') {
      this.notify(
        'corrupt',
        `${this.fileName} was damaged and could not be loaded, so ${APP_NAME} started without ` +
          `it.${outcome.moved ? ' The damaged file was kept.' : ''}`,
        outcome.moved ?? undefined
      )
    } else if (outcome.kind === 'restored') {
      // Written right away: the main file is gone (moved aside) until the next write.
      this.writeNow(outcome.text)
      this.notify(
        'restored-backup',
        `${this.fileName} was damaged; the last good copy was restored.`,
        outcome.moved ?? this.path
      )
    }
    return this.value
  }

  /** The in-memory value. Throws when `load()` was not called. */
  get(): T {
    if (!this.loaded) throw new Error(`[storage] ${this.name} used before load()`)
    return this.value as T
  }

  /** Replaces the in-memory value and schedules a save. */
  set(value: T): void {
    this.value = value
    this.loaded = true
    this.scheduleSave()
  }

  /** Replaces the value with `fn(current)` and schedules a save. */
  update(fn: (current: T) => T): T {
    const next = fn(this.get())
    this.set(next)
    return next
  }

  /** Marks the value dirty; it is written once, `debounceMs` after the first change. */
  scheduleSave(): void {
    this.dirty = true
    this.schedule(this.settings.debounceMs)
  }

  /**
   * Writes pending changes synchronously (also used on quit). Returns false when they did not
   * reach the file: the write failed (it is retried later) or writes are blocked
   * (`writeBlocked`; the changes are written to `<name>.pending.json` instead).
   */
  flush(): boolean {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return true
    if (this.blocked) {
      this.writePending()
      return false
    }
    return this.writeNow()
  }

  /**
   * Copies the current file to `<name>.<tag>-<timestamp>.json` (e.g. before dropping
   * entries that no longer validate). Returns the backup path or `null`.
   */
  backup(tag: string): string | null {
    const target = this.stampedPath(tag)
    try {
      copyFileSync(this.path, target)
      return target
    } catch (err) {
      this.logger.warn(`[storage] Cannot back up ${this.path}: ${errorMessage(err)}`)
      return null
    }
  }

  private write(target: string, text: string): void {
    writeTextFileAtomic(target, text, (err) =>
      this.logger.warn(`[storage] Atomic rename failed for ${target}: ${errorMessage(err)}`)
    )
  }

  private serialize(): string {
    return JSON.stringify(this.value, null, this.settings.indent) + '\n'
  }

  /**
   * Writes `text` (default: the value) to the file; a failure is reported once and retried
   * (`writeRetryMs`).
   */
  private writeNow(text?: string): boolean {
    try {
      this.write(this.path, text ?? this.serialize())
    } catch (err) {
      this.dirty = true
      if (!this.failing) {
        this.failing = true
        this.logger.error(`[storage] Cannot write ${this.path}: ${errorMessage(err)}`)
        this.notify(
          'write-failed',
          `Could not save ${this.fileName}. Your latest changes are kept in memory; ` +
            `${APP_NAME} keeps trying to save them.`,
          this.path
        )
      }
      this.schedule(this.settings.writeRetryMs)
      return false
    }
    this.dirty = false
    if (this.failing) {
      this.failing = false
      this.logger.warn(`[storage] ${this.path} is saved again`)
    }
    return true
  }

  /** Writes are blocked: keep the session's changes next to the file, never in it. */
  private writePending(): void {
    try {
      this.write(this.pendingPath, this.serialize())
      this.dirty = false
    } catch (err) {
      this.logger.error(`[storage] Cannot write ${this.pendingPath}: ${errorMessage(err)}`)
    }
  }

  private schedule(delayMs: number): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, delayMs)
    this.timer.unref?.()
  }

  private notify(kind: StorageNoticeKind, message: string, path?: string): void {
    if (!this.onNotice) return
    const notice: StorageNotice = { kind, file: this.fileName, message, timestamp: this.now() }
    if (path) notice.path = path
    try {
      this.onNotice(notice)
    } catch (err) {
      this.logger.warn(`[storage] Cannot report a storage notice: ${errorMessage(err)}`)
    }
  }

  private now(): number {
    return this.settings.now()
  }

  private stampedPath(tag: string): string {
    return join(this.dir, `${this.name}.${tag}-${fileStamp(this.now())}.json`)
  }
}
