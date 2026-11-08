/**
 * Renderer hardening, applied to every web contents (`guardNewWebContents`) and once more,
 * idempotently, to the main window's (`hardenWebContents`):
 * - main-frame navigations are blocked (in development the dev server's own origin is allowed,
 *   for its full reloads) and never handed to the browser: an injected link, a
 *   `location.href = …` or a meta refresh must not open a site without the user;
 * - subframes never navigate (the UI has no frames; the CSP says `frame-src 'none'` as well);
 * - `window.open` / `target="_blank"` is denied, and http(s) links the user clicked this way open
 *   in the default browser (the other way out is the explicit `app.openExternal` IPC);
 * - no webviews; every permission is denied except writing to the clipboard.
 *
 * DevTools' own frontend (development only: packaged and automated windows have no DevTools) is
 * left free to navigate its frames.
 */
import { shell, type App, type Session, type WebContents } from 'electron'
import { isSameHttpOrigin } from './app-origin'

/** Permissions the UI needs: copying to the clipboard (`navigator.clipboard.writeText`). */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

/** True for absolute `http:` / `https:` URLs. */
export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function openInBrowser(url: string): void {
  if (!isHttpUrl(url)) return
  shell.openExternal(url).catch((err: unknown) => console.warn('[security] openExternal:', err))
}

/** DevTools' frontend (`devtools://…`); web content can never navigate there. */
function isDevToolsFrontend(contents: WebContents): boolean {
  return contents.getURL().startsWith('devtools://')
}

const hardened = new WeakSet<WebContents>()

/** Locks down one web contents (see the module comment); calling it again changes nothing. */
export function hardenWebContents(contents: WebContents, devServerUrl?: string): void {
  if (hardened.has(contents)) return
  hardened.add(contents)
  contents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event) => {
    if (isSameHttpOrigin(event.url, devServerUrl) || isDevToolsFrontend(contents)) return
    event.preventDefault()
  })
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame || isDevToolsFrontend(contents)) return
    event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

/** Denies every permission request / check except the allow-list above. */
export function applySessionPolicy(session: Session): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  session.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission))
}

/** Applies `hardenWebContents` to every web contents the app creates from now on. */
export function guardNewWebContents(app: App, devServerUrl?: string): void {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, devServerUrl))
}
