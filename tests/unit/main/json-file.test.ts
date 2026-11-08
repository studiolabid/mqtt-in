import {
  existsSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageNotice } from '@shared/models'
import { JsonFile, type JsonFileOptions } from '../../../src/main/services/storage/json-file'
import { failAlways, failTimes, fsFaults, resetFsFaults } from './helpers/fs-faults'

vi.mock('node:fs', async (importOriginal) =>
  (await import('./helpers/fs-faults')).faultyFs(await importOriginal())
)

interface Doc {
  count: number
  items: string[]
}

const DEFAULTS: Doc = { count: 0, items: [] }
const quiet = { warn: vi.fn(), error: vi.fn() }

let dir: string
let notices: StorageNotice[]
/** Flushed before the folder is removed: a debounced write would create it again. */
let opened: JsonFile<Doc>[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mqtey-json-'))
  notices = []
  vi.clearAllMocks()
})

afterEach(() => {
  resetFsFaults()
  for (const file of opened) file.flush()
  opened = []
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

function open(name = 'doc', options: JsonFileOptions = {}): JsonFile<Doc> {
  const file = new JsonFile<Doc>(dir, name, {
    debounceMs: 300,
    logger: quiet,
    onNotice: (notice) => notices.push(notice),
    readRetryDelayMs: 1,
    ...options
  })
  opened.push(file)
  return file
}

function seed(doc: Doc, name = 'doc'): string {
  const text = JSON.stringify(doc)
  writeFileSync(join(dir, `${name}.json`), text)
  return text
}

/** Calls of a spied fs function whose first argument (the path) ends with `suffix`. */
function callsFor(fn: unknown, suffix: string): number {
  return vi
    .mocked(fn as (...args: unknown[]) => unknown)
    .mock.calls.filter((args) => String(args[0]).endsWith(suffix)).length
}

describe('JsonFile', () => {
  it('returns the defaults when the file does not exist', () => {
    const file = open()
    expect(file.load(DEFAULTS)).toEqual(DEFAULTS)
    expect(file.get()).toEqual(DEFAULTS)
    expect(file.writeBlocked).toBe(false)
    expect(quiet.warn).not.toHaveBeenCalled()
    expect(notices).toEqual([])
    // No file is no error: it is not read again.
    expect(callsFor(readFileSync, 'doc.json')).toBe(1)
  })

  it('throws when used before load()', () => {
    expect(() => open().get()).toThrow(/before load/)
  })

  it('writes atomically and leaves no temporary file', () => {
    const file = open()
    file.load(DEFAULTS)
    file.set({ count: 2, items: ['a'] })
    expect(file.flush()).toBe(true)
    expect(JSON.parse(readFileSync(file.path, 'utf8'))).toEqual({ count: 2, items: ['a'] })
    expect(existsSync(`${file.path}.tmp`)).toBe(false)
    expect(readdirSync(dir)).toEqual(['doc.json'])

    const reopened = open()
    expect(reopened.load(DEFAULTS)).toEqual({ count: 2, items: ['a'] })
  })

  it('flushes the temporary file to disk before renaming it over the file', () => {
    const file = open()
    file.load(DEFAULTS)
    file.set({ count: 1, items: [] })
    file.flush()
    const fsync = vi.mocked(fsyncSync).mock.invocationCallOrder
    const rename = vi.mocked(renameSync).mock.invocationCallOrder
    expect(fsync).toHaveLength(1)
    expect(rename).toHaveLength(1)
    expect(fsync[0]).toBeLessThan(rename[0])
    expect(vi.mocked(renameSync).mock.calls[0]).toEqual([`${file.path}.tmp`, file.path])
  })

  it('accepts files with a UTF-8 byte order mark', () => {
    writeFileSync(join(dir, 'doc.json'), String.fromCharCode(0xfeff) + '{"count":5,"items":[]}')
    expect(open().load(DEFAULTS)).toEqual({ count: 5, items: [] })
  })

  it('debounces writes and coalesces changes', () => {
    vi.useFakeTimers()
    const file = open()
    file.load(DEFAULTS)
    file.set({ count: 1, items: [] })
    file.update((doc) => ({ ...doc, count: doc.count + 1 }))
    vi.advanceTimersByTime(299)
    expect(existsSync(file.path)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(JSON.parse(readFileSync(file.path, 'utf8'))).toEqual({ count: 2, items: [] })
  })

  it('flush() writes pending changes immediately and is a no-op when clean', () => {
    vi.useFakeTimers()
    const file = open()
    file.load(DEFAULTS)
    expect(file.flush()).toBe(true)
    expect(existsSync(file.path)).toBe(false)
    file.set({ count: 9, items: ['x'] })
    expect(file.flush()).toBe(true)
    expect(JSON.parse(readFileSync(file.path, 'utf8')).count).toBe(9)
    writeFileSync(file.path, '{"count":1,"items":[]}')
    vi.advanceTimersByTime(1000)
    expect(JSON.parse(readFileSync(file.path, 'utf8')).count).toBe(1)
  })

  it('creates the directory on the first write', () => {
    const nested = new JsonFile<Doc>(join(dir, 'a', 'b'), 'doc', { logger: quiet })
    nested.load(DEFAULTS)
    nested.set({ count: 1, items: [] })
    expect(nested.flush()).toBe(true)
    expect(existsSync(join(dir, 'a', 'b', 'doc.json'))).toBe(true)
  })

  it('backs up the current file', () => {
    const file = open()
    file.load(DEFAULTS)
    file.set({ count: 3, items: [] })
    file.flush()
    const backup = file.backup('invalid')
    expect(backup).not.toBeNull()
    expect(backup && readFileSync(backup, 'utf8')).toBe(readFileSync(file.path, 'utf8'))
  })
})

describe('JsonFile: a file that exists but cannot be read', () => {
  it.each(['EBUSY', 'EPERM', 'EIO'])('never overwrites it (%s on every read)', (code) => {
    const original = seed({ count: 7, items: ['keep me'] })
    fsFaults.readFileSync = failAlways('doc.json', code)
    const file = open('doc', { readRetries: 5 })

    expect(file.load(DEFAULTS)).toEqual(DEFAULTS)
    expect(file.writeBlocked).toBe(true)
    // The first read and 5 retries.
    expect(callsFor(readFileSync, 'doc.json')).toBe(6)

    file.set({ count: 1, items: ['new'] })
    expect(file.flush()).toBe(false)
    vi.useFakeTimers()
    file.update((doc) => ({ ...doc, count: 2 }))
    vi.advanceTimersByTime(10_000)
    file.flush()
    resetFsFaults()
    expect(readFileSync(file.path, 'utf8')).toBe(original)
    // The session's changes are kept next to it, never in it.
    expect(JSON.parse(readFileSync(file.pendingPath, 'utf8'))).toEqual({ count: 2, items: ['new'] })
    expect(callsFor(openSync, 'doc.json.tmp')).toBe(0)

    expect(notices).toEqual([
      {
        kind: 'unreadable',
        file: 'doc.json',
        message:
          'Could not read doc.json (file locked or unreadable). Changes are kept in memory and ' +
          'not saved until mqtey restarts.',
        path: file.path,
        timestamp: expect.any(Number)
      }
    ])
  })

  it('loads the real content once a short lock is gone (EBUSY on the first read)', () => {
    seed({ count: 4, items: ['a'] })
    fsFaults.readFileSync = failTimes(1, 'doc.json')
    const file = open()
    expect(file.load(DEFAULTS)).toEqual({ count: 4, items: ['a'] })
    expect(file.writeBlocked).toBe(false)
    expect(notices).toEqual([])
    file.set({ count: 5, items: ['a'] })
    expect(file.flush()).toBe(true)
    expect(JSON.parse(readFileSync(file.path, 'utf8')).count).toBe(5)
  })
})

describe('JsonFile: damaged files and the last good copy', () => {
  it('keeps the last good copy of every file that loads', () => {
    const text = seed({ count: 2, items: [] })
    open().load(DEFAULTS)
    expect(readFileSync(join(dir, 'doc.bak.json'), 'utf8')).toBe(text)
    // Unchanged content: not written again.
    vi.clearAllMocks()
    open().load(DEFAULTS)
    expect(callsFor(openSync, 'doc.bak.json.tmp')).toBe(0)
  })

  it('restores the last good copy when the file is damaged', () => {
    const good = seed({ count: 3, items: ['good'] })
    open().load(DEFAULTS)
    writeFileSync(join(dir, 'doc.json'), '{"count": 3, "ite')

    const file = open()
    expect(file.load(DEFAULTS)).toEqual({ count: 3, items: ['good'] })
    // The damaged file is kept aside, the main file holds the good copy again.
    const corrupt = readdirSync(dir).filter((name) => name.startsWith('doc.corrupt-'))
    expect(corrupt).toHaveLength(1)
    expect(readFileSync(join(dir, corrupt[0]), 'utf8')).toBe('{"count": 3, "ite')
    expect(readFileSync(file.path, 'utf8')).toBe(good)
    expect(notices).toEqual([
      {
        kind: 'restored-backup',
        file: 'doc.json',
        message: 'doc.json was damaged; the last good copy was restored.',
        path: join(dir, corrupt[0]),
        timestamp: expect.any(Number)
      }
    ])
  })

  it('moves a damaged file aside and starts from the defaults without a good copy', () => {
    const path = join(dir, 'doc.json')
    writeFileSync(path, '{ not json')
    const file = open()
    expect(file.load(DEFAULTS)).toEqual(DEFAULTS)
    expect(existsSync(path)).toBe(false)
    const corrupt = readdirSync(dir).filter((name) => name.startsWith('doc.corrupt-'))
    expect(corrupt).toHaveLength(1)
    expect(corrupt[0]).toMatch(/^doc\.corrupt-[\dT-]+Z\.json$/)
    expect(readFileSync(join(dir, corrupt[0]), 'utf8')).toBe('{ not json')
    expect(quiet.warn).toHaveBeenCalledOnce()
    expect(notices).toEqual([
      {
        kind: 'corrupt',
        file: 'doc.json',
        message:
          'doc.json was damaged and could not be loaded, so mqtey started without it. The ' +
          'damaged file was kept.',
        path: join(dir, corrupt[0]),
        timestamp: expect.any(Number)
      }
    ])
  })

  it('treats a throwing parse() as damage, also for the last good copy', () => {
    writeFileSync(join(dir, 'doc.json'), '"just a string"')
    writeFileSync(join(dir, 'doc.bak.json'), '"also a string"')
    const value = open().load(DEFAULTS, (raw) => {
      if (typeof raw !== 'object') throw new Error('expected an object')
      return raw as Doc
    })
    expect(value).toEqual(DEFAULTS)
    expect(readdirSync(dir).some((name) => name.startsWith('doc.corrupt-'))).toBe(true)
    expect(notices.map((notice) => notice.kind)).toEqual(['corrupt'])
  })

  it('keeps no copy when keepBackup is off', () => {
    seed({ count: 1, items: [] })
    open('doc', { keepBackup: false }).load(DEFAULTS)
    expect(existsSync(join(dir, 'doc.bak.json'))).toBe(false)
  })
})

describe('JsonFile: failed writes', () => {
  it('reports a failed write once, keeps the change and saves it once writing works again', () => {
    vi.useFakeTimers()
    const file = open('doc', { writeRetryMs: 5000 })
    file.load(DEFAULTS)
    fsFaults.openSync = failAlways('doc.json.tmp', 'ENOSPC')
    file.set({ count: 1, items: [] })
    expect(file.flush()).toBe(false)
    file.set({ count: 2, items: [] })
    vi.advanceTimersByTime(5000)
    expect(notices.map((notice) => notice.kind)).toEqual(['write-failed'])
    expect(notices[0]).toMatchObject({ file: 'doc.json', path: file.path })
    expect(existsSync(file.path)).toBe(false)

    resetFsFaults()
    vi.advanceTimersByTime(5000)
    expect(JSON.parse(readFileSync(file.path, 'utf8')).count).toBe(2)
    // A new problem after the recovery is reported again.
    fsFaults.openSync = failAlways('doc.json.tmp', 'EACCES')
    file.set({ count: 3, items: [] })
    expect(file.flush()).toBe(false)
    expect(notices.map((notice) => notice.kind)).toEqual(['write-failed', 'write-failed'])
  })
})
