/**
 * Storage composition root: one JSON file per repository in `<userData>/data`.
 *
 * Every storage problem the user must hear about (a file that cannot be read, a corrupt file, a
 * restored backup, skipped entries, a failed write, secrets that cannot be decrypted) goes to
 * `Storage.notices`: the ones raised while opening the files are listed by
 * `app.getStorageNotices()`, later ones are also pushed to the windows (`ipc/broadcast.ts`).
 */
import type { AppSettings } from '@shared/models'
import { type ConnectionsFile, ConnectionsRepo } from './connections-repo'
import { JsonFile, type JsonFileOptions } from './json-file'
import { type KvData, KvRepo } from './kv-repo'
import { StorageNotices } from './notices'
import type { SecretCipher } from './secrets'
import { SettingsRepo } from './settings-repo'
import { type WindowState, WindowStateRepo } from './window-state-repo'

export interface Storage {
  connections: ConnectionsRepo
  settings: SettingsRepo
  kv: KvRepo
  windowState: WindowStateRepo
  /**
   * Storage problems of this session for the user (`app.getStorageNotices`, then
   * `IPC_EVENTS.storageNotice`). The files and repositories push to it from the start.
   */
  notices: StorageNotices
  /** Writes every pending change synchronously (call on quit). */
  flush(): void
}

/**
 * Opens (loads) all repositories.
 * @param dataDir e.g. `join(app.getPath('userData'), 'data')`
 * @param options file options; an `onNotice` given here also receives every notice.
 */
export function createStorage(
  dataDir: string,
  cipher: SecretCipher,
  options: JsonFileOptions = {}
): Storage {
  // First, so the files and repositories below can report their problems (startup included).
  const notices = new StorageNotices()
  const onNotice: JsonFileOptions['onNotice'] = (notice) => {
    notices.push(notice)
    options.onNotice?.(notice)
  }
  const fileOptions: JsonFileOptions = { ...options, onNotice }
  const connectionsFile = new JsonFile<ConnectionsFile>(dataDir, 'connections', fileOptions)
  const settingsFile = new JsonFile<AppSettings>(dataDir, 'settings', fileOptions)
  const kvFile = new JsonFile<KvData>(dataDir, 'storage', fileOptions)
  // Window geometry is not worth a backup or a word to the user (it falls back to a default).
  const windowFile = new JsonFile<WindowState | null>(dataDir, 'window-state', {
    ...options,
    onNotice: undefined,
    keepBackup: false
  })
  const files = [connectionsFile, settingsFile, kvFile, windowFile]
  const logger = options.logger
  const warn = logger ? (message: string): void => logger.warn(message) : undefined

  return {
    connections: new ConnectionsRepo(connectionsFile, cipher, { warn, onNotice }),
    settings: new SettingsRepo(settingsFile),
    kv: new KvRepo(kvFile),
    windowState: new WindowStateRepo(windowFile),
    notices,
    flush: () => {
      for (const file of files) file.flush()
    }
  }
}

export type { ConnectionsRepo } from './connections-repo'
export type { ImportResult, ImportSkip } from './connections-transfer'
export type { KvRepo } from './kv-repo'
export type { StorageNoticeListener, StorageNotices } from './notices'
export type { SecretCipher } from './secrets'
export type { SettingsRepo } from './settings-repo'
export type { WindowState, WindowStateRepo } from './window-state-repo'
