/**
 * `app.getStorageNotices` and `app.showItemInFolder` with the real storage and the real export
 * handler: only files the main process wrote or reported in this session can be revealed.
 * Electron's dialogs and shell are mocked (no window ever opens).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnectionProfile } from '@shared/defaults'
import { IPC, type IpcChannel } from '@shared/ipc'
import type { StorageNotice } from '@shared/models'
import { registerAppIpc } from '../../../src/main/ipc/app'
import { registerConnectionsIpc } from '../../../src/main/ipc/connections'
import type { IpcHandler, RegisterHandler } from '../../../src/main/ipc/handle'
import { knownFiles } from '../../../src/main/services/known-files'
import type { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import { createStorage, type Storage } from '../../../src/main/services/storage'
import { PLAIN_CIPHER } from '../../../src/main/services/storage/secrets'

const electron = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  showItemInFolder: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/documents' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: electron.showSaveDialog },
  shell: { showItemInFolder: electron.showItemInFolder, openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] }
}))

interface Ipc {
  register: RegisterHandler
  invoke: (channel: IpcChannel, ...args: unknown[]) => Promise<unknown>
}

/** Collects handlers like `ipcMain.handle` and calls them like `ipcRenderer.invoke`. */
function fakeIpc(): Ipc {
  const handlers = new Map<IpcChannel, IpcHandler>()
  return {
    register: (channel, handler) => {
      handlers.set(channel, handler)
    },
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler({ window: null }, ...args)
    }
  }
}

const logger = { warn: vi.fn(), error: vi.fn() }
let dir: string
let storage: Storage | null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mqtt-in-app-ipc-'))
  storage = null
  knownFiles.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  storage?.flush()
  rmSync(dir, { recursive: true, force: true })
})

/** The app's IPC on a storage in `data`; `reveal` stands in for the file manager. */
function setup(data = join(dir, 'data')): Ipc & { reveal: ReturnType<typeof vi.fn> } {
  storage = createStorage(data, PLAIN_CIPHER, { logger })
  const ipc = fakeIpc()
  const reveal = vi.fn()
  const manager = { forget: vi.fn(async () => undefined) } as unknown as MqttManager
  registerConnectionsIpc(ipc.register, storage.connections, manager)
  registerAppIpc(ipc.register, { notices: storage.notices, reveal })
  return { ...ipc, reveal }
}

describe('app.showItemInFolder', () => {
  it('refuses every path the main process did not write or report', async () => {
    const elsewhere = join(dir, 'private.txt')
    writeFileSync(elsewhere, 'x')
    const { invoke, reveal } = setup()
    for (const path of [elsewhere, 'C:\\Windows\\win.ini', '/etc/passwd', 'private.txt']) {
      await expect(invoke(IPC.appShowItemInFolder, path)).rejects.toThrow('Unknown file')
    }
    await expect(invoke(IPC.appShowItemInFolder, ['a'])).rejects.toThrow(/Invalid file path/)
    expect(reveal).not.toHaveBeenCalled()
    expect(electron.showItemInFolder).not.toHaveBeenCalled()
  })

  it('reveals a connection export', async () => {
    const { invoke, reveal } = setup()
    storage?.connections.save(createConnectionProfile({ name: 'Exported' }))
    const target = join(dir, 'connections-export.json')
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })

    expect(await invoke(IPC.connectionsExport, undefined, { includeSecrets: false })).toBe(target)
    await invoke(IPC.appShowItemInFolder, target)
    expect(reveal).toHaveBeenCalledWith(target)
  })

  it('reveals the damaged file that a storage notice points to', async () => {
    const data = join(dir, 'data')
    mkdirSync(data)
    writeFileSync(join(data, 'connections.json'), '{ "connections": [ { "name": "cut off')
    const { invoke, reveal } = setup(data)

    const notices = (await invoke(IPC.appStorageNotices)) as StorageNotice[]
    expect(notices.map((notice) => notice.kind)).toEqual(['corrupt'])
    const moved = notices[0].path
    expect(moved).toMatch(/connections\.corrupt-.+\.json$/)
    await invoke(IPC.appShowItemInFolder, moved)
    expect(reveal).toHaveBeenCalledWith(moved)
  })
})
