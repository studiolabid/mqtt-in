/**
 * Registration of `ipcMain.handle` handlers with sender verification.
 */
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebFrameMain } from 'electron'
import type { IpcChannel } from '@shared/ipc'
import { isUiUrl } from '../app-origin'

export interface IpcContext {
  /** The window that sent the request (parent for dialogs), if it still exists. */
  window: BrowserWindow | null
}

/** A handler receives the raw (unvalidated) arguments of the `invoke` call. */
export type IpcHandler = (context: IpcContext, ...args: unknown[]) => unknown

export type RegisterHandler = (channel: IpcChannel, handler: IpcHandler) => void

/** The parts of an invoke event the guard looks at. */
export type SenderEvent = Pick<IpcMainInvokeEvent, 'senderFrame'> & {
  sender?: { mainFrame?: WebFrameMain | null } | null
}

/**
 * True when `frame` is the sender's main frame. Distinct `WebFrameMain` objects can stand for the
 * same frame, so the process and routing ids decide when the objects differ.
 */
function isMainFrame(frame: WebFrameMain, main: WebFrameMain | null | undefined): boolean {
  if (!main) return false
  return (
    frame === main || (frame.processId === main.processId && frame.routingId === main.routingId)
  )
}

/**
 * Only the main frame of our own UI may call the API: the `app://mqtt-in` page or, in development,
 * a page of the Vite dev server's origin. Subframes, file:// and other origins, and a sender
 * frame that is gone (navigated or destroyed) are refused.
 */
export function createSenderGuard(devServerUrl?: string): (event: SenderEvent) => boolean {
  return (event) => {
    const frame = event.senderFrame
    if (!frame || !isMainFrame(frame, event.sender?.mainFrame)) return false
    return isUiUrl(frame.url, devServerUrl)
  }
}

/** Returns a `register(channel, handler)` function that applies `isTrusted` to every call. */
export function createRegistrar(
  isTrusted: (event: IpcMainInvokeEvent) => boolean
): RegisterHandler {
  return (channel, handler) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrusted(event)) throw new Error('Untrusted IPC sender')
      return handler({ window: BrowserWindow.fromWebContents(event.sender) }, ...args)
    })
  }
}
