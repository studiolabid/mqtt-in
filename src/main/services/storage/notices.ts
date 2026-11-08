/**
 * Storage problems the user must hear about (`StorageNotice`): an unreadable or corrupt file, a
 * restored backup, skipped entries, a failed write, secrets that cannot be decrypted.
 *
 * Every notice is kept for the whole session (`app.getStorageNotices()` returns them, also the
 * ones raised during startup, before any window existed) and is passed to the subscribers: the
 * IPC layer forwards it to the open windows (`IPC_EVENTS.storageNotice`, see
 * `ipc/broadcast.ts`). A notice path is added to the known files, so 'Show file' can reveal it.
 * Pure (no electron import).
 */
import type { StorageNotice } from '@shared/models'
import { type KnownFiles, knownFiles } from '../known-files'

export type StorageNoticeListener = (notice: StorageNotice) => void

/** More notices than this in one session are dropped (a failing write could repeat forever). */
export const MAX_STORAGE_NOTICES = 100

export class StorageNotices {
  private readonly notices: StorageNotice[] = []
  private readonly listeners = new Set<StorageNoticeListener>()

  /** @param files where notice paths are registered for `app.showItemInFolder`. */
  constructor(private readonly files: KnownFiles = knownFiles) {}

  /** Every notice of this session, oldest first (copies). */
  list(): StorageNotice[] {
    return this.notices.map((notice) => ({ ...notice }))
  }

  /** Records a notice and passes a copy to every subscriber (a throwing one is only logged). */
  push(notice: StorageNotice): void {
    if (this.notices.length >= MAX_STORAGE_NOTICES) return
    const stored: StorageNotice = { ...notice }
    this.notices.push(stored)
    if (stored.path) this.files.remember(stored.path)
    for (const listener of this.listeners) {
      try {
        listener({ ...stored })
      } catch (err) {
        console.warn('[storage] A storage notice listener failed:', err)
      }
    }
  }

  /** Calls `listener` for every later notice. Returns the function that unsubscribes it. */
  subscribe(listener: StorageNoticeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
