import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnectionProfile, DEFAULT_SETTINGS } from '@shared/defaults'
import type { AppSettings, StorageNotice } from '@shared/models'
import { createStorage } from '../../../src/main/services/storage'
import { JsonFile } from '../../../src/main/services/storage/json-file'
import { type KvData, KvRepo } from '../../../src/main/services/storage/kv-repo'
import { PLAIN_CIPHER } from '../../../src/main/services/storage/secrets'
import { SettingsRepo } from '../../../src/main/services/storage/settings-repo'
import {
  type WindowState,
  WindowStateRepo
} from '../../../src/main/services/storage/window-state-repo'

const logger = { warn: vi.fn(), error: vi.fn() }
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mqtt-in-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const file = <T>(name: string): JsonFile<T> => new JsonFile<T>(dir, name, { logger })

describe('SettingsRepo', () => {
  it('starts from the defaults and persists clamped updates', () => {
    const settingsFile = file<AppSettings>('settings')
    const repo = new SettingsRepo(settingsFile)
    expect(repo.get()).toEqual(DEFAULT_SETTINGS)
    const next = repo.update({ theme: 'dark', maxMessagesPerConnection: 10 })
    expect(next).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', maxMessagesPerConnection: 100 })
    settingsFile.flush()
    expect(new SettingsRepo(file<AppSettings>('settings')).get()).toEqual(next)
  })

  it('rejects invalid patches', () => {
    const repo = new SettingsRepo(file<AppSettings>('settings'))
    expect(() => repo.update({ theme: 'neon' } as unknown as Partial<AppSettings>)).toThrow(
      /Invalid settings/
    )
    expect(repo.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid fields of a damaged settings file', () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ theme: 'light', accent: 'neon', autoScroll: 'yes', extra: 1 })
    )
    expect(new SettingsRepo(file<AppSettings>('settings')).get()).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light'
    })
  })
})

describe('KvRepo', () => {
  it('stores JSON round-trips and deletes undefined values', () => {
    const kvFile = file<KvData>('storage')
    const repo = new KvRepo(kvFile)
    repo.set('layout', { sizes: [30, 70], at: new Date(0) })
    expect(repo.get('layout')).toEqual({ sizes: [30, 70], at: '1970-01-01T00:00:00.000Z' })
    repo.set('gone', 1)
    repo.set('gone', undefined)
    expect(repo.get('gone')).toBeUndefined()
    kvFile.flush()
    expect(JSON.parse(readFileSync(join(dir, 'storage.json'), 'utf8'))).toEqual({
      layout: { sizes: [30, 70], at: '1970-01-01T00:00:00.000Z' }
    })
    expect(new KvRepo(file<KvData>('storage')).get('layout')).toEqual(repo.get('layout'))
  })

  it('rejects values larger than 2 MB or not serializable', () => {
    const repo = new KvRepo(file<KvData>('storage'))
    expect(() => repo.set('big', 'x'.repeat(2 * 1024 * 1024))).toThrow(/too large/)
    expect(() => repo.set('bigint', 10n)).toThrow(/not JSON serializable/)
    expect(repo.get('big')).toBeUndefined()
  })

  it('treats special keys as plain data', () => {
    const repo = new KvRepo(file<KvData>('storage'))
    repo.set('constructor', 'safe')
    expect(repo.get('constructor')).toBe('safe')
    expect(repo.get('toString')).toBeUndefined()
  })
})

describe('WindowStateRepo', () => {
  it('stores rounded bounds and ignores invalid ones', () => {
    const windowFile = file<WindowState | null>('window-state')
    const repo = new WindowStateRepo(windowFile)
    expect(repo.get()).toBeUndefined()
    repo.set({ x: 10.4, y: 20.6, width: 1280.2, height: 800, maximized: true })
    expect(repo.get()).toEqual({ x: 10, y: 21, width: 1280, height: 800, maximized: true })
    repo.set({ width: 0, height: 0, maximized: false })
    expect(repo.get()?.width).toBe(1280)
  })

  it('treats a malformed file as "no saved state"', () => {
    writeFileSync(join(dir, 'window-state.json'), JSON.stringify({ width: 'wide' }))
    expect(new WindowStateRepo(file<WindowState | null>('window-state')).get()).toBeUndefined()
  })
})

describe('createStorage', () => {
  it('opens every repository and flushes them all', () => {
    const storage = createStorage(join(dir, 'data'), PLAIN_CIPHER, { logger })
    storage.settings.update({ accent: 'rose' })
    storage.kv.set('k', 1)
    storage.flush()
    const reopened = createStorage(join(dir, 'data'), PLAIN_CIPHER, { logger })
    expect(reopened.settings.get().accent).toBe('rose')
    expect(reopened.kv.get('k')).toBe(1)
    expect(reopened.connections.list()).toEqual([])
  })

  it('collects the storage problems of every file for the user', () => {
    const data = join(dir, 'data')
    mkdirSync(data)
    for (const name of ['settings', 'storage', 'window-state']) {
      writeFileSync(join(data, `${name}.json`), '{ "damaged')
    }
    const seen: StorageNotice[] = []
    const storage = createStorage(data, PLAIN_CIPHER, {
      logger,
      onNotice: (notice) => seen.push(notice)
    })
    // The window geometry falls back to a default without a word.
    expect(storage.notices.list().map((n) => [n.kind, n.file])).toEqual([
      ['corrupt', 'settings.json'],
      ['corrupt', 'storage.json']
    ])
    expect(seen).toEqual(storage.notices.list())
    expect(storage.settings.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('reports passwords it cannot decrypt, and keeps them', () => {
    const data = join(dir, 'data')
    mkdirSync(data)
    const sealed = `enc:v1:${Buffer.from('sealed elsewhere').toString('base64')}`
    const profile = { ...createConnectionProfile({ name: 'Prod' }), password: sealed }
    writeFileSync(join(data, 'connections.json'), JSON.stringify({ connections: [profile] }))

    const storage = createStorage(data, PLAIN_CIPHER, { logger })
    expect(storage.notices.list().map((n) => n.kind)).toEqual(['secrets-unavailable'])
    expect(storage.connections.list()[0].password).toBe('')
    storage.connections.markConnected(profile.id, 123)
    storage.flush()
    const stored = JSON.parse(readFileSync(join(data, 'connections.json'), 'utf8'))
    expect(stored.connections[0]).toMatchObject({ password: sealed, lastConnectedAt: 123 })
  })

  it('keeps the last good copy of the settings, not of the window geometry', () => {
    const data = join(dir, 'data')
    const storage = createStorage(data, PLAIN_CIPHER, { logger })
    storage.settings.update({ theme: 'dark' })
    storage.windowState.set({ width: 900, height: 700, maximized: false })
    storage.flush()
    createStorage(data, PLAIN_CIPHER, { logger })
    expect(existsSync(join(data, 'settings.bak.json'))).toBe(true)
    expect(existsSync(join(data, 'window-state.bak.json'))).toBe(false)
  })
})
