/**
 * `app.*` — application info, external links, storage notices and revealing files.
 */
import { stat } from 'node:fs/promises'
import { app, safeStorage, shell } from 'electron'
import { APP_NAME } from '@shared/defaults'
import { IPC } from '@shared/ipc'
import type { AppInfo } from '@shared/models'
import { APP_VERSION, isAutomationRun } from '../app-identity'
import { type KnownFiles, knownFiles } from '../services/known-files'
import type { StorageNotices } from '../services/storage'
import type { RegisterHandler } from './handle'
import { parseExternalUrl, parseFilePath } from './validate'

/** Versions, platform and storage facts shown in the About / settings screen. */
export function getAppInfo(): AppInfo {
  return {
    name: APP_NAME,
    version: APP_VERSION,
    platform: process.platform,
    arch: process.arch,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8
    },
    userDataPath: app.getPath('userData'),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}

export interface AppIpcDeps {
  /** Storage problems of this session (`app.getStorageNotices`). */
  notices: StorageNotices
  /** Paths `app.showItemInFolder` may reveal. Default: the process-wide registry. */
  files?: KnownFiles
  /** Opens the file manager at a file. Default: `revealInFileManager`. */
  reveal?: (path: string) => void
}

/**
 * `shell.showItemInFolder`, except in automated runs (`MQTEY_E2E=1`): they never open a window
 * on the user's desktop, so the request is only logged.
 */
export function revealInFileManager(path: string): void {
  if (isAutomationRun(process.env)) {
    console.log(`[app] Automated run: not opening the file manager for ${path}`)
    return
  }
  shell.showItemInFolder(path)
}

/**
 * Registers `app.getInfo`, `app.openExternal` (http, https and mailto only),
 * `app.getStorageNotices` and `app.showItemInFolder` (known files only, see `KnownFiles`).
 */
export function registerAppIpc(register: RegisterHandler, deps: AppIpcDeps): void {
  const files = deps.files ?? knownFiles
  const reveal = deps.reveal ?? revealInFileManager

  register(IPC.appInfo, () => getAppInfo())
  register(IPC.appOpenExternal, async (_ctx, url) => {
    await shell.openExternal(parseExternalUrl(url))
  })
  register(IPC.appStorageNotices, () => deps.notices.list())
  register(IPC.appShowItemInFolder, async (_ctx, rawPath) => {
    const path = parseFilePath(rawPath)
    // Only files this process wrote or reported: the renderer must not probe the file system.
    if (!files.isKnown(path)) throw new Error('Unknown file')
    try {
      await stat(path)
    } catch {
      throw new Error('The file was moved or deleted')
    }
    reveal(path)
  })
}
