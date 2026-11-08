/**
 * Leading + trailing throttle with an explicit `cancel()` (pure, no Vue).
 */

export interface Throttled {
  /** Runs now when the interval has elapsed, otherwise once at the end of the interval. */
  (): void
  /** Runs a pending call immediately (no-op when nothing is pending). */
  flush(): void
  /** Drops a pending call. */
  cancel(): void
}

/**
 * Wraps `fn` so it runs at most once every `intervalMs`. The first call runs synchronously;
 * calls during the interval are coalesced into one trailing run.
 */
export function throttle(fn: () => void, intervalMs: number, now = Date.now): Throttled {
  let last = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | undefined

  const run = (): void => {
    timer = undefined
    last = now()
    fn()
  }

  const throttled = (): void => {
    if (timer !== undefined) return
    const wait = last + intervalMs - now()
    if (wait <= 0) run()
    else timer = setTimeout(run, wait)
  }
  throttled.flush = (): void => {
    if (timer === undefined) return
    clearTimeout(timer)
    run()
  }
  throttled.cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  return throttled
}
