/**
 * The window options that differ between the user's window and the window of an automated run,
 * and between development and packaged builds. Pure (electron types only), so it is unit-tested
 * directly.
 */
import type { BrowserWindowConstructorOptions, WebPreferences } from 'electron'
import { APP_NAME } from '@shared/defaults'

/** Native title of an automated run's window, never the plain app name. */
export const AUTOMATION_WINDOW_TITLE = `${APP_NAME} (automation)`

export interface WindowChromeInput {
  /** Automated run (`MQTTIN_E2E=1`). */
  background: boolean
  platform: NodeJS.Platform
  /** `app.isPackaged`: an installed build, as opposed to a development run. Default false. */
  packaged?: boolean
}

export interface WindowChrome {
  window: Pick<BrowserWindowConstructorOptions, 'title' | 'skipTaskbar' | 'type'>
  webPreferences: Pick<WebPreferences, 'devTools' | 'backgroundThrottling'>
}

/**
 * The user's window is a normal app window; DevTools (F12) exist in development runs only, so a
 * packaged build never opens a console with the bridge (`window.mqttIn`) in reach.
 *
 * An automated run's window must never look like a second open mqtt-in:
 * - no taskbar button and, on Windows, a tool window (`WS_EX_TOOLWINDOW`), which Alt+Tab,
 *   Task View and the taskbar leave out;
 * - its own title;
 * - no DevTools;
 * - timers and animation frames keep running although it is never visible.
 */
export function windowChromeOptions({
  background,
  platform,
  packaged = false
}: WindowChromeInput): WindowChrome {
  if (!background) {
    return {
      window: { title: APP_NAME, skipTaskbar: false },
      webPreferences: { devTools: !packaged, backgroundThrottling: true }
    }
  }
  return {
    window: {
      title: AUTOMATION_WINDOW_TITLE,
      skipTaskbar: true,
      ...(platform === 'win32' ? { type: 'toolbar' } : {})
    },
    webPreferences: { devTools: false, backgroundThrottling: false }
  }
}
