/**
 * FD-01 (optional part): the message list follows a flood at 200 ms instead of 100 ms once the
 * connection moves more than 1,000 msg/s; rows are unreadable at that speed anyway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, type EffectScope } from 'vue'
import {
  FAST_LIST_THROTTLE_MS,
  LIST_THROTTLE_MS,
  listThrottleMs,
  useMessageList
} from '@/composables/useMessageList'
import { useMessagesStore } from '@/stores/messages'
import { DEFAULT_MESSAGE_FILTER } from '@/types'
import { messages } from './helpers'
import { setupStores } from './stores/setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

let scope: EffectScope

function inScope<T>(factory: () => T): T {
  const result = scope.run(factory)
  if (result === undefined) throw new Error('effect scope is not active')
  return result
}

beforeEach(async () => {
  vi.useFakeTimers()
  await setupStores()
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

describe('listThrottleMs', () => {
  it('follows at 100 ms, and at 200 ms above 1,000 msg/s', () => {
    expect(LIST_THROTTLE_MS).toBe(100)
    expect(FAST_LIST_THROTTLE_MS).toBe(200)
    expect(listThrottleMs(0)).toBe(LIST_THROTTLE_MS)
    expect(listThrottleMs(1_000)).toBe(LIST_THROTTLE_MS)
    expect(listThrottleMs(1_001)).toBe(FAST_LIST_THROTTLE_MS)
  })
})

describe('useMessageList under a flood', () => {
  /** Ingests `count` messages, then lets the rate meter tick once (1 s). */
  async function flood(count: number): Promise<void> {
    useMessagesStore().ingest(messages(count, { connectionId: 'a' }))
    await vi.advanceTimersByTimeAsync(1_000)
  }

  it('updates at most every 200 ms while the connection moves more than 1,000 msg/s', async () => {
    const store = useMessagesStore()
    const list = inScope(() => useMessageList('a', { ...DEFAULT_MESSAGE_FILTER }))
    await flood(3_000)
    expect(store.stats('a').inRate).toBeGreaterThan(1_000)
    expect(list.rows.value).toHaveLength(3_000)

    store.ingest(messages(1, { connectionId: 'a' }))
    await nextTick() // the interval changed: a new throttle, whose first call runs at once
    expect(list.rows.value).toHaveLength(3_001)

    store.ingest(messages(1, { connectionId: 'a' }))
    await nextTick()
    await vi.advanceTimersByTimeAsync(150)
    expect(list.rows.value).toHaveLength(3_001) // still waiting: 200 ms between updates
    await vi.advanceTimersByTimeAsync(50)
    expect(list.rows.value).toHaveLength(3_002)
  })

  it('a fixed throttleMs ignores the rate; the adaptive one is back at 100 ms after it', async () => {
    const store = useMessagesStore()
    const filter = { ...DEFAULT_MESSAGE_FILTER }
    const fixed = inScope(() => useMessageList('a', filter, { throttleMs: 0 }))
    const adaptive = inScope(() => useMessageList('a', filter))
    await flood(3_000)
    expect(store.stats('a').inRate).toBeGreaterThan(1_000)
    for (let i = 0; i < 3; i++) {
      store.ingest(messages(1, { connectionId: 'a' }))
      await nextTick()
    }
    expect(fixed.rows.value).toHaveLength(3_003) // every batch, whatever the rate

    await vi.advanceTimersByTimeAsync(6_000) // quiet for longer than the 5 s rate window
    expect(store.stats('a').inRate).toBeLessThanOrEqual(1_000)
    store.ingest(messages(1, { connectionId: 'a' }))
    await nextTick() // the interval changed back: the new throttle runs at once
    store.ingest(messages(1, { connectionId: 'a' }))
    await nextTick()
    expect(adaptive.rows.value).toHaveLength(3_004)
    await vi.advanceTimersByTimeAsync(100)
    expect(adaptive.rows.value).toHaveLength(3_005)
  })
})
