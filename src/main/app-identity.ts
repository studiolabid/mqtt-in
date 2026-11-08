/**
 * App identity, the same for every launch mode (packaged, `electron .`, electron-vite or the main
 * script itself): one name and one profile folder, and therefore one single-instance lock.
 * Pure (no electron import), so it is unit-tested directly.
 */
import { join, resolve } from 'node:path'
import { version } from '../../package.json'

/** The app version from package.json (`app.getVersion()` reports Electron's own in file mode). */
export const APP_VERSION: string = version

/** Windows AppUserModelID of automated runs: never grouped with the user's own window. */
export const AUTOMATION_APP_USER_MODEL_ID = 'com.mqtey.app.automation'

export interface UserDataDirInput {
  /** `app.getPath('appData')` (%APPDATA% on Windows). */
  appData: string
  /** `MQTEY_USER_DATA_DIR`: an isolated profile (automated runs, parallel test runs). */
  override?: string
  /** The app name (`APP_NAME`). */
  name: string
}

/** The profile folder: the override when it is set, `<appData>/<name>` otherwise. */
export function resolveUserDataDir({ appData, override, name }: UserDataDirInput): string {
  const custom = override?.trim()
  return custom ? resolve(custom) : join(appData, name)
}

/**
 * `MQTEY_E2E=1` marks an automated run (tests, scripts, agents): its window never appears on the
 * user's desktop (see `windowChromeOptions`).
 */
export function isAutomationRun(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.MQTEY_E2E === '1'
}
