/**
 * Main-process bootstrap: single instance, storage + MQTT services, IPC, menu, the `app://mqtt-in`
 * origin of the UI, the main window, graceful quit (flush storage, disconnect every session).
 * Unexpected errors and crashed processes go to `<userData>/logs/main.log` (no stack-trace
 * dialogs).
 */
import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeTheme, safeStorage, session } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { APP_NAME } from '@shared/defaults'
import { AUTOMATION_APP_USER_MODEL_ID, isAutomationRun, resolveUserDataDir } from './app-identity'
import { registerAppScheme, serveAppProtocol } from './app-protocol'
import { createWindowEventSink, registerIpc } from './ipc'
import { createMainLog, logUncaughtErrors } from './main-log'
import { errorMessage } from './utils/errors'
import { buildAppMenu } from './menu'
import { secondInstanceAction } from './second-instance'
import { applySessionPolicy, guardNewWebContents } from './security'
import { MqttManager } from './services/mqtt/mqtt-manager'
import { createStorage, type Storage } from './services/storage'
import { createSafeStorageCipher } from './services/storage/secrets'
import { createMainWindow } from './window'

/** How long quitting waits for sessions to disconnect gracefully. */
const QUIT_TIMEOUT_MS = 1500

interface Services {
  storage: Storage
  manager: MqttManager
}

/**
 * One identity for every launch mode. Started by its main script (`electron out/main/index.js`),
 * Electron would run as "Electron" with another profile, and so another single-instance lock.
 * `MQTTIN_USER_DATA_DIR` isolates the profile (automated runs, parallel test runs).
 */
app.setName(APP_NAME)
app.setPath(
  'userData',
  resolveUserDataDir({
    appData: app.getPath('appData'),
    override: process.env.MQTTIN_USER_DATA_DIR,
    name: APP_NAME
  })
)

/** Uncaught exceptions and rejections are logged and the app keeps running (no error box). */
const mainLog = createMainLog(join(app.getPath('userData'), 'logs'))
logUncaughtErrors(mainLog)

/** The UI's own origin (`app://mqtt-in`): the scheme must be privileged before the app is ready. */
registerAppScheme()

/**
 * `MQTTIN_E2E=1` (automated runs): an off-screen tool window that never takes focus and has no
 * taskbar or Alt+Tab entry (see createMainWindow), no DevTools and no native error boxes, so test
 * runs never appear on the user's desktop.
 */
const background = isAutomationRun(process.env)
if (background) {
  // Windows treats an off-screen window as occluded and stops painting it; keep it rendering
  // (screenshots, animation frames).
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
}

/** An automated run never touches the user's own profile (or their open mqtt-in window). */
const isolated = Boolean(process.env.MQTTIN_USER_DATA_DIR?.trim())

/**
 * Always a single instance per profile: launching mqtt-in again focuses the open window instead
 * of opening a second one. The lock is tied to the userData folder (set above), so isolated
 * test profiles can still run side by side.
 */
if (background && !isolated) {
  console.error('[app] MQTTIN_E2E=1 needs MQTTIN_USER_DATA_DIR (an isolated profile). Quitting.')
  app.exit(2)
} else if (app.requestSingleInstanceLock()) {
  start()
} else {
  app.quit()
}

function createServices(): Services {
  const dataDir = join(app.getPath('userData'), 'data')
  const storage = createStorage(dataDir, createSafeStorageCipher(safeStorage))
  const manager = new MqttManager({
    profiles: storage.connections,
    sink: createWindowEventSink(),
    onConnected: (connectionId, at) => storage.connections.markConnected(connectionId, at)
  })
  return { storage, manager }
}

function start(): void {
  const devServerUrl = is.dev ? process.env.ELECTRON_RENDERER_URL : undefined
  let services: Services | null = null
  let mainWindow: BrowserWindow | null = null
  let quitting = false
  /** mqtt-in was launched again while quitting: start again once this process has quit. */
  let relaunchRequested = false

  /**
   * The UI could not load and the user was told: disconnect the sessions (a dropped connection
   * would make brokers publish their Last Wills), save, then exit with code 1.
   */
  const quitAfterLoadFailure = (): void => {
    for (const win of BrowserWindow.getAllWindows()) win.hide()
    if (quitting) return // a quit is already disconnecting and saving
    if (!services) {
      app.exit(1)
      return
    }
    quitting = true
    const { storage, manager } = services
    void manager.disposeAll(QUIT_TIMEOUT_MS).finally(() => {
      storage.flush()
      app.exit(1)
    })
  }

  const openMainWindow = (): void => {
    if (!services) return
    const win = createMainWindow({
      windowState: services.storage.windowState,
      theme: services.storage.settings.get().theme,
      devServerUrl,
      background,
      log: (kind, detail) => mainLog.append(kind, detail),
      onLoadFailure: quitAfterLoadFailure
    })
    mainWindow = win
    win.on('closed', () => {
      if (mainWindow === win) mainWindow = null
    })
  }

  // Someone launched mqtt-in again (that process quits right away): bring this window forward,
  // reopen it when it was closed (macOS keeps the app running without windows), or, while this
  // instance is still quitting, start again afterwards (see `secondInstanceAction`).
  app.on('second-instance', () => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    const action = secondInstanceAction({ background, quitting, hasWindow: win !== null })
    if (action === 'relaunch-after-quit') {
      relaunchRequested = true
    } else if (action === 'reopen') {
      openMainWindow()
    } else if (action === 'focus' && win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.on('browser-window-created', (_event, window) => {
    // F12 DevTools in development; blocks reload shortcuts in production. Zoom is in the menu.
    if (!background) optimizer.watchWindowShortcuts(window, { zoom: true })
  })

  guardNewWebContents(app, devServerUrl)

  // GPU, network or utility processes: Chromium restarts them; keep a trace.
  app.on('child-process-gone', (_event, details) => {
    console.warn(`[app] A ${details.type} process is gone (${details.reason})`)
    mainLog.append('child-process-gone', details)
  })

  app
    .whenReady()
    .then(() => {
      if (background) {
        // Never grouped with (or shown as) the user's own mqtt-in.
        if (process.platform === 'win32') app.setAppUserModelId(AUTOMATION_APP_USER_MODEL_ID)
        app.dock?.hide()
      } else {
        electronApp.setAppUserModelId('com.mqttin.app')
      }
      applySessionPolicy(session.defaultSession)
      serveAppProtocol(join(__dirname, '../renderer'))
      services = createServices()
      nativeTheme.themeSource = services.storage.settings.get().theme
      registerIpc({ storage: services.storage, manager: services.manager, devServerUrl })
      Menu.setApplicationMenu(buildAppMenu(is.dev))
      openMainWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
      })
    })
    .catch((err: unknown) => {
      console.error('[app] Startup failed:', err)
      mainLog.append('startup-failed', err)
      if (!background) dialog.showErrorBox('mqtt-in could not start', errorMessage(err))
      app.exit(1)
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitting || !services) return
    // Defer the quit once: disconnect sessions gracefully (bounded), then quit for real.
    event.preventDefault()
    quitting = true
    const { storage, manager } = services
    storage.flush()
    void manager.disposeAll(QUIT_TIMEOUT_MS).finally(() => {
      storage.flush()
      if (relaunchRequested) app.relaunch()
      app.quit()
    })
  })

  app.on('will-quit', () => services?.storage.flush())
}
