/**
 * The origin of the built UI: `app://mqtey` (entry page `app://mqtey/index.html`). Pure (node:path
 * only), so the URL rules are unit-tested directly; `app-protocol.ts` registers and serves the
 * scheme.
 *
 * Why not file://: a page on file:// may read any local file, and CSP `'self'` matches every
 * file: URL there. On its own privileged standard scheme the UI has a real origin: `'self'` is
 * `app://mqtey` only, file: URLs are out of reach for fetch, frames and scripts, and the handler
 * serves the files of the renderer folder and nothing else.
 *
 * App URLs are matched on their canonical text (Chromium lower-cases and normalizes standard-scheme
 * URLs before main sees them). Node's URL parser is no help here: it gives every non-special
 * scheme the opaque origin 'null', and it resolves `..` / `%2e%2e` segments silently.
 */
import { resolve, sep } from 'node:path'

export const APP_SCHEME = 'app'
export const APP_HOST = 'mqtey'
/** The UI's origin in production (the Vite dev server's in development). */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
/** The UI's entry page. */
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`

/** `app://mqtey`, then the raw (still percent-encoded) path, then a query, a hash or the end. */
const APP_URL = /^app:\/\/mqtey(\/[^?#]*)?(?:[?#]|$)/

/** The entry page at a hash route (`/connections/abc`; '' = the start page). */
export function appPageUrl(route = ''): string {
  const url = new URL(APP_INDEX_URL)
  url.hash = route
  return url.toString()
}

/** True for `app://mqtey/…` URLs (no port, no credentials, no other host). */
export function isAppUrl(url: string): boolean {
  return APP_URL.test(url)
}

/** The origin of an absolute `http:` / `https:` URL, `null` for anything else. */
export function httpOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

/** True when `url` is on the http(s) origin of `base` (the Vite dev server). */
export function isSameHttpOrigin(url: string, base: string | undefined): boolean {
  if (!base) return false
  const origin = httpOrigin(base)
  return origin !== null && httpOrigin(url) === origin
}

/** True for a page of the UI: `app://mqtey` or, in development, the dev server's origin. */
export function isUiUrl(url: string, devServerUrl?: string): boolean {
  return isAppUrl(url) || isSameHttpOrigin(url, devServerUrl)
}

/** Back slashes, drive letters / NTFS streams (`:`) and control characters (NUL included). */
function hasForbiddenChar(path: string): boolean {
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i)
    if (code < 0x20 || code === 0x7f || path[i] === '\\' || path[i] === ':') return true
  }
  return false
}

/**
 * A path segment that is never one of our files: empty (`//`), `.` / `..`, or one Windows would
 * silently change (a trailing dot or space: `index.html.` opens `index.html`, `.. ` becomes `..`).
 */
function isUnsafeSegment(segment: string): boolean {
  return segment === '' || /[. ]$/.test(segment)
}

/**
 * The file inside `root` (the built renderer folder) that an `app://mqtey/…` request asks for,
 * or `null` when the URL is not ours or its path could leave `root`: `..` / `.` segments, also
 * percent-encoded (`%2e%2e`, `..%2f`), back slashes (`\`, `%5c`), drive letters and NTFS streams
 * (any `:`), control characters, empty segments, trailing dots or spaces. `/` is the entry page;
 * the query and the hash are ignored.
 */
export function resolveAppPath(root: string, url: string): string | null {
  const match = APP_URL.exec(url)
  if (!match) return null
  let path: string
  try {
    path = decodeURIComponent(match[1] ?? '/')
  } catch {
    return null // malformed percent-encoding
  }
  if (path === '/') path = '/index.html'
  if (hasForbiddenChar(path)) return null
  const segments = path.slice(1).split('/')
  if (segments.some(isUnsafeSegment)) return null
  const base = resolve(root)
  const file = resolve(base, ...segments)
  return file.startsWith(base + sep) ? file : null
}
