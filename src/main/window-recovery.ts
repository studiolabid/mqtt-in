/**
 * Keeps the main window usable when its renderer crashes or hangs (the MQTT sessions run in the
 * main process and keep running either way).
 *
 * - A crashed renderer (`render-process-gone`, anything but 'clean-exit') is reloaded; the UI
 *   restores the sessions from the main process through `getSessions()`. The first reload returns
 *   to the route the window showed; another crash within the minute reloads the start page (that
 *   route may be the cause). At most 3 automatic reloads a minute (`ReloadLimiter`); after that
 *   the user chooses Reload or Quit.
 * - A hung renderer (`unresponsive`) offers Wait or Reload; the question closes by itself when the
 *   window responds again.
 * - Automated runs (`MQTTIN_E2E=1`) never show these dialogs: they reload within the limit and log.
 */
import { app, type BrowserWindow, dialog } from 'electron'
import { APP_NAME } from '@shared/defaults'
import { isRendererCrash, RELOAD_LIMIT, ReloadLimiter, reloadRoute } from './crash-policy'

/** 'current': the route the window showed; 'start': the start page. */
export type ReloadRoute = 'current' | 'start'

export interface RecoveryOptions {
  /** Automated run: never a dialog. */
  background: boolean
  /** Loads the UI again, the same way as the first load, at `route`. */
  reload: (route: ReloadRoute) => void
  /** Keeps an entry in the main log (`main.log`). */
  log?: (kind: string, detail: unknown) => void
}

/** Reload or Quit, once the automatic reloads are used up. */
async function askAfterCrashes(
  win: BrowserWindow,
  reload: RecoveryOptions['reload']
): Promise<void> {
  const { response } = await dialog.showMessageBox(win, {
    type: 'error',
    title: APP_NAME,
    message: `${APP_NAME}'s window stopped working`,
    detail: `It was reloaded ${RELOAD_LIMIT} times in the last minute. Your connections keep running.`,
    buttons: ['Reload', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  if (win.isDestroyed()) return
  if (response === 0) reload('start')
  else app.quit()
}

/** Wait or Reload while the window does not respond; `signal` closes the question. */
async function askWhileHung(win: BrowserWindow, signal: AbortSignal): Promise<boolean> {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: APP_NAME,
    message: `${APP_NAME} is not responding`,
    detail: 'You can wait for it or reload the window. Your connections keep running.',
    buttons: ['Wait', 'Reload'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    signal
  })
  return response === 1 && !signal.aborted
}

/** Watches the renderer of `win` (see the module comment). */
export function watchRendererHealth(win: BrowserWindow, options: RecoveryOptions): void {
  const limiter = new ReloadLimiter()
  const contents = win.webContents
  let hang: AbortController | null = null
  let asking = false

  contents.on('render-process-gone', (_event, details) => {
    console.error(
      `[window] The renderer is gone (${details.reason}, exit code ${details.exitCode})`
    )
    options.log?.('render-process-gone', details)
    hang?.abort()
    hang = null
    if (win.isDestroyed() || !isRendererCrash(details.reason)) return
    const now = Date.now()
    const route = reloadRoute(limiter.recent(now))
    if (limiter.tryReload(now)) {
      options.reload(route)
      return
    }
    console.error(`[window] The renderer crashed ${RELOAD_LIMIT} times within a minute`)
    if (options.background || asking) return
    asking = true
    void askAfterCrashes(win, options.reload).finally(() => {
      asking = false
    })
  })

  win.on('unresponsive', () => {
    console.warn('[window] The window is not responding')
    options.log?.('unresponsive', 'The window is not responding')
    if (options.background || hang || win.isDestroyed()) return
    const controller = new AbortController()
    hang = controller
    void askWhileHung(win, controller.signal).then((reload) => {
      if (hang === controller) hang = null
      // The crash handler above reloads it.
      if (reload && !win.isDestroyed()) contents.forcefullyCrashRenderer()
    })
  })

  win.on('responsive', () => {
    hang?.abort()
    hang = null
  })
}
