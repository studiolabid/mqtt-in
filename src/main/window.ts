/**
 * The main window: hidden native title bar (window-controls overlay on Windows / Linux,
 * inset traffic lights on macOS), sandboxed renderer, persisted geometry, and a renderer that is
 * reloaded when it crashes (`watchRendererHealth`).
 *
 * The UI loads from `app://mqtey/index.html` (served by `app-protocol.ts`), or from the Vite dev
 * server in development. DevTools exist in development runs only. A page that fails to load never
 * stays a blank window (`watchLoadFailures`).
 *
 * Automated runs (`MQTEY_E2E=1`) get a window that never appears on the user's desktop (see
 * `windowChromeOptions`) and no crash, hang or load-failure dialogs. Native dialogs of the app
 * still would: automation must stub `dialog.*` (through `electronApp.evaluate`) before triggering
 * an import, export or file picker.
 */
import { join } from 'node:path'
import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import type { ThemeMode } from '@shared/models'
import icon from '../../resources/icon.png?asset'
import { appPageUrl } from './app-origin'
import { hardenWebContents } from './security'
import type { WindowStateRepo } from './services/storage'
import { backgroundColor, isDarkMode, titleBarOverlay } from './theme'
import { MIN_WINDOW_SIZE, offscreenBounds, resolveInitialBounds } from './window-bounds'
import { watchLoadFailures } from './window-load'
import { windowChromeOptions } from './window-options'
import { watchRendererHealth } from './window-recovery'

export interface MainWindowOptions {
  windowState: WindowStateRepo
  /** Theme from the settings (decides the initial background: no white flash). */
  theme: ThemeMode
  /** Vite dev server URL in development; `app://mqtey/index.html` is loaded otherwise. */
  devServerUrl?: string
  /**
   * Automated runs (`MQTEY_E2E=1`): an off-screen tool window that opens without taking focus,
   * with no taskbar or Alt+Tab entry, no DevTools and no crash, hang or load-failure dialogs;
   * its geometry is not saved.
   */
  background?: boolean
  /** Keeps renderer crashes, hangs and load failures in the main log. */
  log?: (kind: string, detail: unknown) => void
  /**
   * Called after the "could not start" error box of a failed load (never in automated runs).
   * Default: `app.exit(1)`.
   */
  onLoadFailure?: () => void
}

/** The hash route of a page URL (`/connections/abc` for `…/index.html#/connections/abc`), or ''. */
function routeOf(url: string): string {
  try {
    return new URL(url).hash.replace(/^#/, '')
  } catch {
    return ''
  }
}

/**
 * Loads the UI at a hash route ('' = the start page): the Vite dev server in development,
 * `app://mqtey/index.html` otherwise. The first load and crash reloads both come here.
 */
function loadRenderer(win: BrowserWindow, devServerUrl: string | undefined, route = ''): void {
  if (win.isDestroyed()) return
  let load: Promise<void>
  if (devServerUrl) {
    const url = new URL(devServerUrl)
    url.hash = route
    load = win.loadURL(url.toString())
  } else {
    load = win.loadURL(appPageUrl(route))
  }
  // A failed load is reported (and handled) by `watchLoadFailures`.
  load.catch((err: unknown) => console.error('[window] Failed to load the renderer:', err))
}

const SAVE_STATE_DELAY_MS = 500

function frameOptions(dark: boolean): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } }
  }
  return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(dark) }
}

/** Saves the normal bounds + maximized flag (debounced while resizing / moving, final on close). */
function trackWindowState(win: BrowserWindow, repo: WindowStateRepo): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (win.isDestroyed() || win.isMinimized()) return
    repo.set({ ...win.getNormalBounds(), maximized: win.isMaximized() })
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, SAVE_STATE_DELAY_MS)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', save)
}

/** Creates (and loads) the main window; it is shown once the renderer is ready. */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const dark = isDarkMode(options.theme)
  const background = options.background === true
  const displays = screen.getAllDisplays()
  const initial = background
    ? { bounds: offscreenBounds(displays.map((display) => display.bounds)), maximized: false }
    : resolveInitialBounds(
        options.windowState.get(),
        displays.map((display) => display.workArea),
        screen.getPrimaryDisplay().workArea
      )
  const chrome = windowChromeOptions({
    background,
    platform: process.platform,
    packaged: app.isPackaged
  })

  const win = new BrowserWindow({
    ...initial.bounds,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    ...chrome.window,
    backgroundColor: backgroundColor(dark),
    autoHideMenuBar: true,
    // Windows / Linux: the window (taskbar) icon; macOS uses the app bundle's icon.
    ...(process.platform !== 'darwin' ? { icon } : {}),
    ...frameOptions(dark),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      ...chrome.webPreferences
    }
  })

  hardenWebContents(win.webContents, options.devServerUrl)
  if (background) {
    // Keep the automation title (the renderer would set the document title).
    win.on('page-title-updated', (event) => event.preventDefault())
  } else {
    trackWindowState(win, options.windowState)
  }

  win.once('ready-to-show', () => {
    if (background) {
      win.showInactive()
      return
    }
    if (initial.maximized) win.maximize()
    win.show()
  })

  watchLoadFailures(win.webContents, {
    background,
    log: options.log,
    quit: options.onLoadFailure
  })
  watchRendererHealth(win, {
    background,
    // After a crash the page URL is still the one it showed.
    reload: (route) =>
      loadRenderer(
        win,
        options.devServerUrl,
        route === 'current' ? routeOf(win.webContents.getURL()) : ''
      ),
    log: options.log
  })
  loadRenderer(win, options.devServerUrl)

  return win
}
