/**
 * The IPC channels added with the cross-group contracts: storage notices, 'Show in folder' for
 * known files only, export options and the import outcome. Handlers are registered on a fake
 * registrar; electron's dialogs and shell are mocked (no window ever opens).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnectionProfile } from '@shared/defaults'
import { IPC, IPC_EVENTS, type IpcChannel } from '@shared/ipc'
import type { ConnectionProfile, ImportConnectionsResult, StorageNotice } from '@shared/models'
import { registerAppIpc, revealInFileManager } from '../../../src/main/ipc/app'
import { forwardStorageNotices } from '../../../src/main/ipc/broadcast'
import { registerConnectionsIpc } from '../../../src/main/ipc/connections'
import type { IpcHandler, RegisterHandler } from '../../../src/main/ipc/handle'
import { KnownFiles, knownFiles } from '../../../src/main/services/known-files'
import type { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import {
  type ConnectionsFile,
  ConnectionsRepo
} from '../../../src/main/services/storage/connections-repo'
import { JsonFile } from '../../../src/main/services/storage/json-file'
import { StorageNotices } from '../../../src/main/services/storage/notices'
import { PLAIN_CIPHER } from '../../../src/main/services/storage/secrets'

interface FakeWindow {
  isDestroyed: () => boolean
  webContents: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> }
}

const electron = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showItemInFolder: vi.fn(),
  windows: [] as FakeWindow[]
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/documents' },
  dialog: { showOpenDialog: electron.showOpenDialog, showSaveDialog: electron.showSaveDialog },
  shell: { showItemInFolder: electron.showItemInFolder, openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => electron.windows }
}))

function fakeWindow(destroyed = false): FakeWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { isDestroyed: () => destroyed, send: vi.fn() }
  }
}

interface FakeRegistrar {
  register: RegisterHandler
  invoke: (channel: IpcChannel, ...args: unknown[]) => Promise<unknown>
}

/** Collects handlers like `ipcMain.handle` and calls them like `ipcRenderer.invoke`. */
function registrar(): FakeRegistrar {
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

let dir: string
let file: JsonFile<ConnectionsFile>
let repo: ConnectionsRepo

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mqtt-in-ipc-'))
  file = new JsonFile<ConnectionsFile>(dir, 'connections', {
    logger: { warn: vi.fn(), error: vi.fn() }
  })
  repo = new ConnectionsRepo(file, PLAIN_CIPHER, { warn: vi.fn() })
  knownFiles.clear()
  vi.clearAllMocks()
  // The import handler logs every skipped entry.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  file.flush()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

function notice(overrides: Partial<StorageNotice> = {}): StorageNotice {
  return {
    kind: 'corrupt',
    file: 'connections.json',
    message: 'connections.json was damaged.',
    timestamp: 1,
    ...overrides
  }
}

describe('app.getStorageNotices / app.showItemInFolder', () => {
  function setup(): { notices: StorageNotices; reveal: ReturnType<typeof vi.fn> } & FakeRegistrar {
    const files = new KnownFiles()
    const notices = new StorageNotices(files)
    const reveal = vi.fn()
    const ipc = registrar()
    registerAppIpc(ipc.register, { notices, files, reveal })
    return { ...ipc, notices, reveal }
  }

  it('returns every storage notice of the session', async () => {
    const { notices, invoke } = setup()
    expect(await invoke(IPC.appStorageNotices)).toEqual([])
    notices.push(notice({ timestamp: 1 }))
    notices.push(notice({ kind: 'write-failed', timestamp: 2 }))
    expect(await invoke(IPC.appStorageNotices)).toEqual([
      notice({ timestamp: 1 }),
      notice({ kind: 'write-failed', timestamp: 2 })
    ])
  })

  it('refuses a path that the main process never wrote or reported', async () => {
    const elsewhere = join(dir, 'secret.txt')
    writeFileSync(elsewhere, 'x')
    const { invoke, reveal } = setup()
    await expect(invoke(IPC.appShowItemInFolder, elsewhere)).rejects.toThrow('Unknown file')
    await expect(invoke(IPC.appShowItemInFolder, 'secret.txt')).rejects.toThrow('Unknown file')
    await expect(invoke(IPC.appShowItemInFolder, 42)).rejects.toThrow(/Invalid file path/)
    await expect(invoke(IPC.appShowItemInFolder, '')).rejects.toThrow(/Invalid file path/)
    expect(reveal).not.toHaveBeenCalled()
  })

  it('reveals the path of a storage notice, and refuses it once the file is gone', async () => {
    const moved = join(dir, 'connections.corrupt-1.json')
    writeFileSync(moved, '{')
    const { notices, invoke, reveal } = setup()
    notices.push(notice({ path: moved }))
    await invoke(IPC.appShowItemInFolder, moved)
    expect(reveal).toHaveBeenCalledWith(moved)
    rmSync(moved)
    await expect(invoke(IPC.appShowItemInFolder, moved)).rejects.toThrow(
      'The file was moved or deleted'
    )
  })
})

describe('forwardStorageNotices', () => {
  it('sends every later notice to the open windows until stopped', () => {
    const open = fakeWindow()
    const closed = fakeWindow(true)
    electron.windows = [open, closed]
    const notices = new StorageNotices(new KnownFiles())
    notices.push(notice({ timestamp: 1 }))
    const stop = forwardStorageNotices(notices)
    notices.push(notice({ kind: 'write-failed', timestamp: 2 }))
    expect(open.webContents.send).toHaveBeenCalledTimes(1)
    expect(open.webContents.send).toHaveBeenCalledWith(
      IPC_EVENTS.storageNotice,
      notice({ kind: 'write-failed', timestamp: 2 })
    )
    expect(closed.webContents.send).not.toHaveBeenCalled()
    stop()
    notices.push(notice({ timestamp: 3 }))
    expect(open.webContents.send).toHaveBeenCalledTimes(1)
    electron.windows = []
  })
})

describe('revealInFileManager', () => {
  it('opens the file manager, but never in an automated run', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.stubEnv('MQTTIN_E2E', '1')
    revealInFileManager('/exports/a.json')
    expect(electron.showItemInFolder).not.toHaveBeenCalled()
    vi.stubEnv('MQTTIN_E2E', '')
    revealInFileManager('/exports/a.json')
    expect(electron.showItemInFolder).toHaveBeenCalledWith('/exports/a.json')
  })
})

describe('connections.exportToFile / importFromFile', () => {
  function setup(): FakeRegistrar {
    const ipc = registrar()
    // Import and export never touch live sessions.
    const manager = { forget: vi.fn(async () => undefined) } as unknown as MqttManager
    registerConnectionsIpc(ipc.register, repo, manager)
    return ipc
  }

  it('exports to the chosen file, takes the options and lets the renderer reveal it', async () => {
    repo.save(createConnectionProfile({ name: 'A' }))
    repo.save(createConnectionProfile({ name: 'B' }))
    const target = join(dir, 'export.json')
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    const { invoke } = setup()

    expect(await invoke(IPC.connectionsExport, undefined, { includeSecrets: true })).toBe(target)
    const written = JSON.parse(readFileSync(target, 'utf8')) as {
      connections: ConnectionProfile[]
    }
    expect(written.connections.map((p) => p.name)).toEqual(['A', 'B'])
    expect(knownFiles.isKnown(target)).toBe(true)

    const app = registrar()
    const reveal = vi.fn()
    registerAppIpc(app.register, { notices: new StorageNotices(new KnownFiles()), reveal })
    await app.invoke(IPC.appShowItemInFolder, target)
    expect(reveal).toHaveBeenCalledWith(target)
  })

  it('refuses invalid export options before showing a dialog', async () => {
    repo.save(createConnectionProfile({ name: 'A' }))
    const { invoke } = setup()
    for (const options of [{ includeSecrets: 'yes' }, { plainText: true }, 'all']) {
      await expect(invoke(IPC.connectionsExport, undefined, options)).rejects.toThrow(
        /Invalid export options/
      )
    }
    expect(electron.showSaveDialog).not.toHaveBeenCalled()
  })

  it('returns null and remembers nothing when the export is cancelled', async () => {
    repo.save(createConnectionProfile({ name: 'A' }))
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    expect(await setup().invoke(IPC.connectionsExport, [repo.list()[0].id])).toBeNull()
  })

  it('returns the import outcome (imported, 20 skipped listed, counts, source)', async () => {
    const source = join(dir, 'import.json')
    const invalid = Array.from({ length: 25 }, (_, i) => ({ name: `Bad ${i}`, port: 99_999 }))
    const connections = [{ name: 'Good', host: 'broker.local' }, 'not an object', ...invalid]
    writeFileSync(source, JSON.stringify({ app: 'mqtt-in', version: 1, connections }))
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })

    const result = (await setup().invoke(IPC.connectionsImport)) as ImportConnectionsResult
    expect(result.imported.map((p) => p.name)).toEqual(['Good'])
    expect(result.skipped).toHaveLength(20)
    // Entries without a name are listed without one; positions stay in main.
    expect(Object.keys(result.skipped[0])).toEqual(['reason'])
    expect(result.skipped[1]).toEqual({ name: 'Bad 0', reason: expect.stringContaining('port') })
    expect(result).toMatchObject({ duplicates: 0, tlsPathsCleared: 0, source: 'mqtt-in' })
    expect(repo.list().map((p) => p.name)).toEqual(['Good'])
  })

  it('recognizes a single profile', async () => {
    const source = join(dir, 'single.json')
    writeFileSync(source, JSON.stringify({ name: 'Single', host: 'h' }))
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })
    const result = (await setup().invoke(IPC.connectionsImport)) as ImportConnectionsResult
    expect(result).toMatchObject({ source: 'profile', skipped: [], duplicates: 0 })
    expect(result.imported.map((p) => p.name)).toEqual(['Single'])
  })

  it('returns null when cancelled and rejects a file without any valid entry', async () => {
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const { invoke } = setup()
    expect(await invoke(IPC.connectionsImport)).toBeNull()

    const source = join(dir, 'bad.json')
    writeFileSync(source, JSON.stringify([{ name: 'Bad', port: 0 }]))
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })
    await expect(invoke(IPC.connectionsImport)).rejects.toThrow(
      /^No valid connections in the file \(Bad: port/
    )
  })
})
