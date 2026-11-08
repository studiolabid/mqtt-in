/**
 * Serves the built UI on its own privileged origin, `app://mqtey` (see `app-origin.ts` for why
 * not file://):
 * - `registerAppScheme()` before the app is ready: a standard, secure scheme (a real origin, a
 *   secure context for the clipboard and the window-controls overlay), usable by fetch and CORS
 *   (Vite's `crossorigin` module scripts), with V8 code caching;
 * - `serveAppProtocol(root)` once it is ready: GET / HEAD requests get the files under `root`
 *   (the built renderer folder) through `net.fetch` of their file URL, so MIME types and reads
 *   from app.asar work as for file://. A path that is refused or missing gets a network error
 *   (`net::ERR_FAILED`, as a missing file on file:// did): Chromium would render a 404 response
 *   as an empty page, while a network error fails the load (`did-fail-load`, see
 *   window-load.ts). Other methods get a 405.
 *
 * The Vite dev server (development) does not use this scheme.
 */
import { stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { APP_SCHEME, resolveAppPath } from './app-origin'

/** Loads a `file:` URL (`net.fetch` in the app; a fake in tests). */
export type FileLoader = (fileUrl: string) => Promise<Response>

/** Marks `app:` as a privileged standard scheme. Call once, before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        codeCache: true
      }
    }
  ])
}

/** True when `path` is an existing regular file (not a folder or a device). */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Answers one `app://` request with a file under `root` (see the module comment). */
export async function respondWithAppFile(
  request: Request,
  root: string,
  load: FileLoader = (fileUrl) => net.fetch(fileUrl)
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405 })
  }
  const file = resolveAppPath(root, request.url)
  if (!file || !(await isFile(file))) return Response.error()
  const response = await load(pathToFileURL(file).toString())
  if (request.method === 'GET') return response
  await response.body?.cancel()
  return new Response(null, { status: response.status, headers: response.headers })
}

/** Serves the files under `root` on `app://mqtey` (default session). Call once it is ready. */
export function serveAppProtocol(root: string): void {
  protocol.handle(APP_SCHEME, (request) => respondWithAppFile(request, root))
}
