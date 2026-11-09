/**
 * A failed navigation must never leave an empty window. It mostly happens when a lazily loaded
 * chunk (the workspace, the settings) cannot be fetched, e.g. while the Vite dev server restarts
 * or re-optimizes its dependencies. Without a handler the router stays on its start location and
 * shows nothing.
 *
 * - A chunk error reloads the window once, on the route that failed.
 * - Another failure within `RELOAD_WINDOW_MS`, or any other error, keeps the current screen (the
 *   welcome screen when nothing is shown yet) and shows a toast with Retry.
 *
 * The time of the last reload is kept in `sessionStorage`, which survives the reload of this
 * window only. Without storage the window never reloads by itself (no reload loop).
 */
import type { RouteLocationNormalized, Router } from 'vue-router'
import { ROUTE_NAMES } from '@/composables/useNavigation'
import { errorMessage } from '@/services/api'
import { reportProblem } from './notices'

export const RELOAD_KEY = 'mqtt-in.reloadAfterLoadFailure'
/** A failure within this time after an automatic reload does not reload again. */
export const RELOAD_WINDOW_MS = 30_000

/** Messages of a chunk that could not be fetched (Chromium, WebKit, Firefox, Vite preload). */
const CHUNK_ERROR =
  /dynamically imported module|importing a module script failed|unable to preload css|outdated optimize dep/i

/** True for the error of a lazily loaded chunk that could not be fetched. */
export function isChunkLoadError(err: unknown): boolean {
  return CHUNK_ERROR.test(errorMessage(err))
}

type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * True (and the reload recorded at `now`) when the window should reload for `err`: a chunk error
 * with no automatic reload in the last `RELOAD_WINDOW_MS`. Never true without `storage`.
 */
export function shouldReload(err: unknown, storage: ReloadStorage | null, now: number): boolean {
  if (!storage || !isChunkLoadError(err)) return false
  try {
    const last = Number(storage.getItem(RELOAD_KEY))
    if (last > 0 && now - last < RELOAD_WINDOW_MS) return false
    storage.setItem(RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}

export interface NavigationRecoveryDeps {
  storage: () => ReloadStorage | null
  now: () => number
  /** Reloads the window on the hash route `path`. */
  reload: (path: string) => void
  report: typeof reportProblem
}

function sessionStore(): ReloadStorage | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

const defaultDeps: NavigationRecoveryDeps = {
  storage: sessionStore,
  now: Date.now,
  reload: (path) => {
    history.replaceState(history.state, '', `#${path}`)
    location.reload()
  },
  report: reportProblem
}

function failureTitle(to: RouteLocationNormalized): string {
  if (to.name === ROUTE_NAMES.connection) return 'Could not open the connection'
  if (to.name === ROUTE_NAMES.settings) return 'Could not open the settings'
  return 'Could not open this page'
}

/** Handles the router's navigation errors (install before `app.use(router)`). */
export function installNavigationRecovery(
  router: Router,
  deps: NavigationRecoveryDeps = defaultDeps
): void {
  router.onError((err: unknown, to: RouteLocationNormalized) => {
    console.error(`[mqtt-in] could not open ${to.fullPath}:`, err)
    if (shouldReload(err, deps.storage(), deps.now())) {
      deps.reload(to.fullPath)
      return
    }
    // Nothing shown yet (the start location): show the welcome screen instead of a blank one.
    if (router.currentRoute.value.matched.length === 0) {
      router.replace({ name: ROUTE_NAMES.welcome }).catch(() => undefined)
    }
    deps.report(failureTitle(to), {
      description: errorMessage(err),
      action: {
        label: 'Retry',
        onClick: () => {
          router.push(to.fullPath).catch(() => undefined)
        }
      }
    })
  })
}
