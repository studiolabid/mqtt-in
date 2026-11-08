/**
 * Bounded file reads (`readFileWithLimit`: the 32 MB `dialog.openFile` limit, the 16 MB import
 * limit) on real temp files, and the open / save dialog wrappers with Electron's dialog mocked
 * (no dialog ever opens).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIMITS } from '@shared/defaults'
import {
  chooseOpenPath,
  chooseSavePath,
  readFileWithLimit
} from '../../../src/main/ipc/file-dialogs'

const DOCUMENTS = resolve(tmpdir(), 'mqtey-documents')

const electron = vi.hoisted(() => ({ showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }))

vi.mock('electron', () => ({
  app: { getPath: () => DOCUMENTS },
  dialog: { showOpenDialog: electron.showOpenDialog, showSaveDialog: electron.showSaveDialog }
}))

const MB = 1024 * 1024
let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mqtey-file-dialogs-'))
  mkdirSync(join(dir, 'folder'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  vi.clearAllMocks()
})

function file(name: string, bytes: number): string {
  const path = join(dir, name)
  writeFileSync(path, Buffer.alloc(bytes, 0x61))
  return path
}

describe('readFileWithLimit', () => {
  it('reads a file of exactly the limit', async () => {
    const data = await readFileWithLimit(file('at-limit.bin', 2048), 2048)
    expect(data.byteLength).toBe(2048)
  })

  it('refuses a file one byte over the limit, with the sizes in MB', async () => {
    await expect(readFileWithLimit(file('over-limit.bin', 2049), 2048)).rejects.toThrow(
      /^File is too large \(0\.0 MB, max 0 MB\)$/
    )
  })

  it('holds the 32 MB limit of dialog.openFile', async () => {
    expect(LIMITS.maxOpenFileBytes).toBe(32 * MB)
    const just = file('just-under.bin', 32 * MB)
    expect((await readFileWithLimit(just, LIMITS.maxOpenFileBytes)).byteLength).toBe(32 * MB)
    const over = file('just-over.bin', 32 * MB + 1)
    await expect(readFileWithLimit(over, LIMITS.maxOpenFileBytes)).rejects.toThrow(
      'File is too large (32.0 MB, max 32 MB)'
    )
    rmSync(just)
    rmSync(over)
  })

  it('names the 16 MB import limit the same way', async () => {
    const over = file('import-over.bin', 16 * MB + 1)
    await expect(readFileWithLimit(over, 16 * MB)).rejects.toThrow(
      'File is too large (16.0 MB, max 16 MB)'
    )
    rmSync(over)
  })

  it('refuses a folder and reports a missing file', async () => {
    await expect(readFileWithLimit(join(dir, 'folder'), MB)).rejects.toThrow('Not a regular file')
    await expect(readFileWithLimit(join(dir, 'missing.bin'), MB)).rejects.toThrow(/ENOENT/)
  })
})

describe('chooseOpenPath', () => {
  const win = { id: 1 } as unknown as BrowserWindow

  it('returns the chosen file, modal to the window', async () => {
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\a.json'] })
    const filters = [{ name: 'JSON', extensions: ['json'] }]
    expect(await chooseOpenPath(win, { title: 'Import', filters })).toBe('C:\\a.json')
    expect(electron.showOpenDialog).toHaveBeenCalledWith(win, {
      title: 'Import',
      filters,
      properties: ['openFile']
    })
  })

  it('returns null when cancelled or empty, and works without a window', async () => {
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await chooseOpenPath(null, {})).toBeNull()
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    expect(await chooseOpenPath(null, {})).toBeNull()
    expect(electron.showOpenDialog.mock.calls[0]).toHaveLength(1)
  })
})

describe('chooseSavePath', () => {
  it('starts a bare file name in the Documents folder', async () => {
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: 'C:\\out.json' })
    expect(await chooseSavePath(null, { defaultPath: 'mqtey-connections.json' })).toBe(
      'C:\\out.json'
    )
    expect(electron.showSaveDialog.mock.calls[0][0]).toMatchObject({
      defaultPath: join(DOCUMENTS, 'mqtey-connections.json')
    })
  })

  it('keeps an absolute default path and returns null when cancelled', async () => {
    const absolute = join(dir, 'export.json')
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    expect(await chooseSavePath(null, { defaultPath: absolute })).toBeNull()
    expect(electron.showSaveDialog.mock.calls[0][0]).toMatchObject({ defaultPath: absolute })
  })
})
