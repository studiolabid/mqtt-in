/**
 * App facts, file dialogs and storage notices.
 */

export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  versions: { electron: string; chrome: string; node: string; v8: string }
  userDataPath: string
  /** Whether passwords are encrypted at rest (Electron safeStorage). */
  encryptionAvailable: boolean
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface PickFileOptions {
  title?: string
  filters?: FileFilter[]
}

export interface OpenFileResult {
  path: string
  name: string
  size: number
  data: Uint8Array
}

export interface SaveFileOptions {
  title?: string
  defaultPath?: string
  filters?: FileFilter[]
  /** UTF-8 text or raw bytes. */
  content: string | Uint8Array
}

/**
 * - `unreadable`: the file exists but could not be read (locked, no permission); changes are kept
 *   in memory and not saved.
 * - `corrupt`: unparsable; it was moved aside and the defaults are used.
 * - `restored-backup`: the file was damaged and the last good copy was loaded.
 * - `invalid-entries`: some entries were skipped (a copy of the original file was kept).
 * - `write-failed`: a change could not be saved.
 * - `secrets-unavailable`: saved passwords cannot be decrypted on this system.
 */
export type StorageNoticeKind =
  | 'unreadable'
  | 'corrupt'
  | 'restored-backup'
  | 'invalid-entries'
  | 'write-failed'
  | 'secrets-unavailable'

/** A storage problem the user must hear about (`app.getStorageNotices` / `onStorageNotice`). */
export interface StorageNotice {
  kind: StorageNoticeKind
  /** File name, e.g. 'connections.json'. */
  file: string
  /** Short human sentence. */
  message: string
  /** Absolute path for 'Show file' (moved-aside copy, backup or the file itself). */
  path?: string
  /** Epoch ms. */
  timestamp: number
}
