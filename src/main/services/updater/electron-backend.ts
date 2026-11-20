/**
 * `UpdaterBackend` over electron-updater's `autoUpdater`, reading the GitHub releases of
 * studiolabid/mqtt-in (configured by `publish` in electron-builder.yml, which writes
 * `app-update.yml` next to the packaged app). Each release must carry `latest.yml` (and the
 * installer's `.blockmap` for small, differential downloads).
 *
 * Only created for builds that can update (see `updateSupport`): touching `autoUpdater`
 * instantiates the platform updater.
 */
import { autoUpdater } from 'electron-updater'
import type { UpdaterBackend } from './update-service'

export interface ElectronBackendOptions {
  /** Lines for the main log (electron-updater's own `info` chatter is dropped). */
  log: (kind: string, detail?: unknown) => void
}

export function createElectronUpdaterBackend(options: ElectronBackendOptions): UpdaterBackend {
  const updater = autoUpdater
  updater.autoDownload = true
  // A downloaded update is installed when the app quits, even without "Restart & update".
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = false
  updater.logger = {
    info: () => undefined,
    warn: (message?: unknown) => options.log('updater-warn', String(message)),
    error: (message?: unknown) => options.log('updater-error', String(message))
  }

  return {
    listen(events) {
      updater.on('checking-for-update', () => events.checking())
      updater.on('update-available', (info) => events.available({ version: info.version }))
      updater.on('update-not-available', () => events.notAvailable())
      updater.on('download-progress', (progress) => events.progress(progress.percent))
      updater.on('update-downloaded', (info) => events.downloaded({ version: info.version }))
      updater.on('error', (err) => events.error(err))
    },
    async check() {
      await updater.checkForUpdates()
    },
    quitAndInstall() {
      // Silent install into the same folder, then start the new version.
      updater.quitAndInstall(true, true)
    }
  }
}
