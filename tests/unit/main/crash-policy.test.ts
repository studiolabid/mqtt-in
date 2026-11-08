import { describe, expect, it } from 'vitest'
import {
  isRendererCrash,
  RELOAD_LIMIT,
  RELOAD_WINDOW_MS,
  ReloadLimiter,
  reloadRoute,
  shouldReload
} from '../../../src/main/crash-policy'

describe('shouldReload', () => {
  it('allows 3 reloads within 60 s, then refuses', () => {
    expect([RELOAD_LIMIT, RELOAD_WINDOW_MS]).toEqual([3, 60_000])
    const now = 100_000
    expect(shouldReload([], now)).toBe(true)
    expect(shouldReload([now - 1_000], now)).toBe(true)
    expect(shouldReload([now - 2_000, now - 1_000], now)).toBe(true)
    expect(shouldReload([now - 3_000, now - 2_000, now - 1_000], now)).toBe(false)
  })

  it('allows reloads again once the window has passed', () => {
    const now = 500_000
    const recent = [now - 59_999, now - 59_998, now - 59_997]
    expect(shouldReload(recent, now)).toBe(false)
    // One millisecond later the first reload is 60 s old and no longer counts.
    expect(shouldReload(recent, now + 1)).toBe(true)
    expect(shouldReload([now - 120_000, now - 61_000, now - 60_000], now)).toBe(true)
  })

  it('takes the earlier reloads in any order', () => {
    const now = 90_000
    expect(shouldReload([now - 10, now - 70_000, now - 20, now - 30], now)).toBe(false)
    expect(shouldReload([now - 70_000, now - 20, now - 80_000], now)).toBe(true)
  })
})

describe('ReloadLimiter', () => {
  it('records the reloads it allows', () => {
    const limiter = new ReloadLimiter()
    const start = 1_000_000
    expect([start, start + 1, start + 2].map((at) => limiter.tryReload(at))).toEqual([
      true,
      true,
      true
    ])
    expect(limiter.tryReload(start + 10_000)).toBe(false)
    // A refused reload does not count: a minute after the first one, one is allowed again.
    expect(limiter.tryReload(start + RELOAD_WINDOW_MS)).toBe(true)
    expect(limiter.tryReload(start + RELOAD_WINDOW_MS + 1)).toBe(true)
    expect(limiter.tryReload(start + RELOAD_WINDOW_MS + 2)).toBe(true)
    expect(limiter.tryReload(start + RELOAD_WINDOW_MS + 3)).toBe(false)
  })

  it('counts the reloads of the last minute', () => {
    const limiter = new ReloadLimiter()
    expect(limiter.recent(0)).toBe(0)
    limiter.tryReload(1_000)
    limiter.tryReload(2_000)
    expect(limiter.recent(2_000)).toBe(2)
    expect(limiter.recent(61_500)).toBe(1)
    expect(limiter.recent(62_000)).toBe(0)
  })
})

describe('reloadRoute', () => {
  it('returns to the route the window showed once, then to the start page', () => {
    expect(reloadRoute(0)).toBe('current')
    expect(reloadRoute(1)).toBe('start')
    expect(reloadRoute(2)).toBe('start')
  })
})

describe('isRendererCrash', () => {
  it('treats everything but a clean exit as a crash', () => {
    expect(isRendererCrash('clean-exit')).toBe(false)
    for (const reason of ['crashed', 'killed', 'oom', 'abnormal-exit', 'launch-failed']) {
      expect(isRendererCrash(reason)).toBe(true)
    }
  })
})
