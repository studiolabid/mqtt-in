/**
 * What to do when the renderer of a window goes away, as pure decisions (`window-recovery.ts`
 * acts on them): a crashed renderer is reloaded automatically at most `RELOAD_LIMIT` times within
 * `RELOAD_WINDOW_MS`. A renderer that keeps crashing would otherwise reload forever; after the
 * limit the user decides (automation runs only log).
 * Pure (no electron import), so it is unit-tested directly.
 */

/** Automatic reloads allowed within `RELOAD_WINDOW_MS`. */
export const RELOAD_LIMIT = 3

export const RELOAD_WINDOW_MS = 60_000

/**
 * True when one more automatic reload is allowed at `now` (epoch ms), given the times of the
 * earlier automatic reloads (any order; the ones older than the window do not count).
 */
export function shouldReload(
  previousReloads: readonly number[],
  now: number,
  limit = RELOAD_LIMIT,
  windowMs = RELOAD_WINDOW_MS
): boolean {
  return previousReloads.filter((at) => now - at < windowMs).length < limit
}

/** The automatic reloads of one window (see `shouldReload`). */
export class ReloadLimiter {
  private reloads: number[] = []

  /** How many automatic reloads happened within `RELOAD_WINDOW_MS` before `now`. */
  recent(now: number): number {
    this.reloads = this.reloads.filter((at) => now - at < RELOAD_WINDOW_MS)
    return this.reloads.length
  }

  /** Allows (and records) a reload at `now`, or refuses it when the limit is reached. */
  tryReload(now: number): boolean {
    if (this.recent(now) >= RELOAD_LIMIT) return false
    this.reloads.push(now)
    return true
  }
}

/**
 * Where a crashed renderer is reloaded: the route it showed ('current') the first time, the start
 * page ('start') when it crashed again within the window, since that route may be the cause.
 */
export function reloadRoute(recentReloads: number): 'current' | 'start' {
  return recentReloads === 0 ? 'current' : 'start'
}

/**
 * True for a `render-process-gone` reason that is a crash. `clean-exit` is the renderer ending
 * normally (the window closes).
 */
export function isRendererCrash(reason: string): boolean {
  return reason !== 'clean-exit'
}
