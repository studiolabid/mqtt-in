import { readonly, ref, type Ref } from 'vue'

/**
 * One shared wall clock for every `RelativeTime` instance (a single interval, not one per
 * component). `fast` updates every second, `slow` every 30 seconds; consumers read only the
 * clock they need so old timestamps do not re-render every second.
 * The interval only runs while at least one consumer holds the clock.
 */
const fastNow = ref(Date.now())
const slowNow = ref(Date.now())

let holders = 0
let ticks = 0
let timer: ReturnType<typeof setInterval> | null = null

const SLOW_EVERY = 30

function tick(): void {
  const now = Date.now()
  fastNow.value = now
  ticks += 1
  if (ticks % SLOW_EVERY === 0) slowNow.value = now
}

/** Read-only shared clocks (epoch ms). */
export const sharedClock: { fast: Readonly<Ref<number>>; slow: Readonly<Ref<number>> } = {
  fast: readonly(fastNow),
  slow: readonly(slowNow)
}

/**
 * Starts (or joins) the shared ticker and returns an idempotent release function.
 * The clocks are refreshed synchronously when the ticker (re)starts, so the first read is
 * never stale.
 */
export function holdSharedClock(): () => void {
  holders += 1
  if (timer === null) {
    const now = Date.now()
    fastNow.value = now
    slowNow.value = now
    ticks = 0
    timer = setInterval(tick, 1000)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    holders -= 1
    if (holders === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}
