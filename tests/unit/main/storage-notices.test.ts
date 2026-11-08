import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { StorageNotice } from '@shared/models'
import { KnownFiles } from '../../../src/main/services/known-files'
import { createStorage } from '../../../src/main/services/storage'
import { MAX_STORAGE_NOTICES, StorageNotices } from '../../../src/main/services/storage/notices'
import { PLAIN_CIPHER } from '../../../src/main/services/storage/secrets'

function notice(overrides: Partial<StorageNotice> = {}): StorageNotice {
  return {
    kind: 'write-failed',
    file: 'connections.json',
    message: 'Changes to connections.json could not be saved.',
    timestamp: 1,
    ...overrides
  }
}

describe('StorageNotices', () => {
  it('keeps every notice of the session, oldest first, and hands out copies', () => {
    const notices = new StorageNotices(new KnownFiles('linux'))
    expect(notices.list()).toEqual([])
    notices.push(notice({ kind: 'corrupt', timestamp: 1 }))
    notices.push(notice({ kind: 'write-failed', timestamp: 2 }))
    const listed = notices.list()
    expect(listed.map((n) => n.kind)).toEqual(['corrupt', 'write-failed'])
    listed[0].message = 'changed'
    expect(notices.list()[0].message).not.toBe('changed')
  })

  it('passes later notices to the subscribers until they unsubscribe', () => {
    const notices = new StorageNotices(new KnownFiles('linux'))
    const listener = vi.fn()
    const unsubscribe = notices.subscribe(listener)
    notices.push(notice({ timestamp: 3 }))
    expect(listener).toHaveBeenCalledWith(notice({ timestamp: 3 }))
    unsubscribe()
    notices.push(notice({ timestamp: 4 }))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(notices.list()).toHaveLength(2)
  })

  it('keeps notifying when one subscriber throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const notices = new StorageNotices(new KnownFiles('linux'))
    const second = vi.fn()
    notices.subscribe(() => {
      throw new Error('boom')
    })
    notices.subscribe(second)
    notices.push(notice())
    expect(second).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('makes a notice path a known file (for "Show file")', () => {
    const files = new KnownFiles('linux')
    const notices = new StorageNotices(files)
    notices.push(notice({ kind: 'corrupt', path: '/data/connections.corrupt-1.json' }))
    expect(files.isKnown('/data/connections.corrupt-1.json')).toBe(true)
  })

  it(`stops collecting after ${MAX_STORAGE_NOTICES} notices`, () => {
    const notices = new StorageNotices(new KnownFiles('linux'))
    const listener = vi.fn()
    notices.subscribe(listener)
    for (let i = 0; i < MAX_STORAGE_NOTICES + 5; i++) notices.push(notice({ timestamp: i }))
    expect(notices.list()).toHaveLength(MAX_STORAGE_NOTICES)
    expect(listener).toHaveBeenCalledTimes(MAX_STORAGE_NOTICES)
  })
})

describe('createStorage', () => {
  it('starts every session without notices', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mqtt-in-notices-'))
    try {
      const logger = { warn: vi.fn(), error: vi.fn() }
      const storage = createStorage(join(dir, 'data'), PLAIN_CIPHER, { logger })
      expect(storage.notices.list()).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
