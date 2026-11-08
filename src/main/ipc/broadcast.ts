/**
 * Pushes main-process events to every open window: the MQTT `EventSink` and storage notices.
 */
import { BrowserWindow } from 'electron'
import { IPC_EVENTS, type IpcEventChannel } from '@shared/ipc'
import type { EventSink } from '../services/mqtt/types'
import type { StorageNotices } from '../services/storage'

/** Sends `payload` on `channel` to every live window (a window being reloaded is skipped). */
export function broadcast(channel: IpcEventChannel, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    try {
      win.webContents.send(channel, payload)
    } catch (err) {
      // The frame can disappear during a reload; the renderer re-syncs via getSessions().
      console.warn(`[ipc] Cannot deliver ${channel}:`, err)
    }
  }
}

/** An `EventSink` that sends every event to all live windows over `IPC_EVENTS.*`. */
export function createWindowEventSink(): EventSink {
  return {
    status: (event) => broadcast(IPC_EVENTS.status, event),
    messages: (batch) => broadcast(IPC_EVENTS.messages, batch),
    subscription: (event) => broadcast(IPC_EVENTS.subscription, event),
    log: (entry) => broadcast(IPC_EVENTS.log, entry),
    repeat: (event) => broadcast(IPC_EVENTS.repeat, event)
  }
}

/**
 * Sends every later storage notice to all live windows (`IPC_EVENTS.storageNotice`). Notices
 * raised before (startup) are fetched by the renderer with `app.getStorageNotices()`.
 * Returns the function that stops forwarding.
 */
export function forwardStorageNotices(notices: StorageNotices): () => void {
  return notices.subscribe((notice) => broadcast(IPC_EVENTS.storageNotice, notice))
}
