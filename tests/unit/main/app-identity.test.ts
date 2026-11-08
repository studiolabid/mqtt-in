import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { APP_NAME } from '@shared/defaults'
import { APP_VERSION, isAutomationRun, resolveUserDataDir } from '../../../src/main/app-identity'
import { getAppInfo } from '../../../src/main/ipc/app'

vi.mock('electron', () => ({
  app: { getPath: () => '/profile', getVersion: () => '44.0.0' },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => undefined },
  ipcMain: { handle: () => undefined },
  BrowserWindow: { fromWebContents: () => null }
}))

const packageVersion = (
  JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as {
    version: string
  }
).version

describe('app identity', () => {
  it('uses <appData>/mqtey as the profile in every launch mode', () => {
    const appData = resolve('/users/me/AppData/Roaming')
    expect(resolveUserDataDir({ appData, name: APP_NAME })).toBe(join(appData, 'mqtey'))
    expect(resolveUserDataDir({ appData, override: '', name: APP_NAME })).toBe(
      join(appData, 'mqtey')
    )
    expect(resolveUserDataDir({ appData, override: '   ', name: APP_NAME })).toBe(
      join(appData, 'mqtey')
    )
  })

  it('uses the resolved MQTEY_USER_DATA_DIR override when it is set', () => {
    const appData = resolve('/users/me/AppData/Roaming')
    expect(resolveUserDataDir({ appData, override: 'tmp/profile-1', name: APP_NAME })).toBe(
      resolve('tmp/profile-1')
    )
  })

  it('recognizes automated runs by MQTEY_E2E=1 only', () => {
    expect(isAutomationRun({ MQTEY_E2E: '1' })).toBe(true)
    expect(isAutomationRun({ MQTEY_E2E: '0' })).toBe(false)
    expect(isAutomationRun({ MQTEY_E2E: 'true' })).toBe(false)
    expect(isAutomationRun({})).toBe(false)
  })

  it("reports package.json's version, not Electron's", () => {
    expect(APP_VERSION).toBe(packageVersion)
    const info = getAppInfo()
    expect(info.name).toBe(APP_NAME)
    expect(info.version).toBe(packageVersion)
  })
})
