/**
 * A UI page that fails to load (a missing or damaged build, a file the app:// handler refuses, a
 * dev server that is down) must not leave a blank white window: the failure is logged and,
 * outside automated runs, the user is told and the app quits.
 */
import { app, dialog, type WebContents } from 'electron'
import { APP_NAME } from '@shared/defaults'

/** Chromium's `net::ERR_ABORTED`: a newer navigation, or closing the window, cancelled the load. */
export const ERR_ABORTED = -3

export interface LoadFailureOptions {
  /** Automated run (`MQTTIN_E2E=1`): log only, never an error box. */
  background: boolean
  /** Keeps an entry in the main log (`main.log`). */
  log?: (kind: string, detail: unknown) => void
  /** Called after the error box. Default: `app.exit(1)`. */
  quit?: () => void
}

/** Watches the main-frame loads of `contents` (see the module comment). */
export function watchLoadFailures(contents: WebContents, options: LoadFailureOptions): void {
  contents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
    if (!isMainFrame || errorCode === ERR_ABORTED) return
    console.error(`[window] The UI did not load (${errorDescription}, ${errorCode}): ${url}`)
    options.log?.('did-fail-load', { errorCode, errorDescription, url })
    if (options.background) return
    dialog.showErrorBox(
      `${APP_NAME} could not start`,
      `Its window could not be loaded (${errorDescription || `error ${errorCode}`}). ` +
        `Reinstalling ${APP_NAME} should fix this.`
    )
    if (options.quit) options.quit()
    else app.exit(1)
  })
}
