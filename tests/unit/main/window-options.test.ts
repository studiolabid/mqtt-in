import { describe, expect, it } from 'vitest'
import { APP_NAME } from '@shared/defaults'
import { AUTOMATION_WINDOW_TITLE, windowChromeOptions } from '../../../src/main/window-options'

const PLATFORMS = ['win32', 'darwin', 'linux'] as const

describe('windowChromeOptions', () => {
  it('makes an automated run on Windows a tool window without taskbar entry or DevTools', () => {
    const chrome = windowChromeOptions({ background: true, platform: 'win32' })
    expect(chrome.window).toEqual({
      title: AUTOMATION_WINDOW_TITLE,
      skipTaskbar: true,
      type: 'toolbar'
    })
    expect(chrome.webPreferences).toEqual({ devTools: false, backgroundThrottling: false })
    expect(AUTOMATION_WINDOW_TITLE).not.toBe(APP_NAME)
  })

  it('uses no window type for automated runs on macOS and Linux', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const chrome = windowChromeOptions({ background: true, platform })
      expect(chrome.window.type).toBeUndefined()
      expect(chrome.window.skipTaskbar).toBe(true)
      expect(chrome.window.title).toBe(AUTOMATION_WINDOW_TITLE)
      expect(chrome.webPreferences.devTools).toBe(false)
    }
  })

  it('keeps the user window a normal app window', () => {
    for (const platform of PLATFORMS) {
      for (const packaged of [false, true]) {
        const chrome = windowChromeOptions({ background: false, platform, packaged })
        expect(chrome.window).toEqual({ title: APP_NAME, skipTaskbar: false })
        expect(chrome.webPreferences.backgroundThrottling).toBe(true)
      }
    }
  })

  it('has DevTools in unpackaged (development) runs only', () => {
    for (const platform of PLATFORMS) {
      expect(windowChromeOptions({ background: false, platform }).webPreferences.devTools).toBe(
        true
      )
      expect(
        windowChromeOptions({ background: false, platform, packaged: false }).webPreferences
          .devTools
      ).toBe(true)
      expect(
        windowChromeOptions({ background: false, platform, packaged: true }).webPreferences.devTools
      ).toBe(false)
    }
  })

  it('never has DevTools in automated runs, packaged or not', () => {
    for (const platform of PLATFORMS) {
      for (const packaged of [false, true]) {
        const chrome = windowChromeOptions({ background: true, platform, packaged })
        expect(chrome.webPreferences.devTools).toBe(false)
      }
    }
  })
})
