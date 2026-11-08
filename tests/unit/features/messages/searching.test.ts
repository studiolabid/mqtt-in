/**
 * RC-01 consumer: the "Searching…" indicator follows `MessageList.pending`, but only for passes
 * longer than a blink, and it clears as soon as the pass ends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope, type Ref } from 'vue'
import { SEARCHING_DELAY_MS, useSearching } from '@/features/messages/composables/useSearching'

let scope: EffectScope

beforeEach(() => {
  vi.useFakeTimers()
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

function setup(initial = false): { pending: Ref<boolean>; searching: () => boolean } {
  const pending = ref(initial)
  const searching = scope.run(() => useSearching(() => pending.value))
  if (!searching) throw new Error('effect scope is not active')
  return { pending, searching: () => searching.value }
}

describe('useSearching', () => {
  it('shows only passes that last longer than the delay', async () => {
    const { pending, searching } = setup()
    pending.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCHING_DELAY_MS - 1)
    expect(searching()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(searching()).toBe(true)
    pending.value = false
    await nextTick()
    expect(searching()).toBe(false) // at once
  })

  it('never flashes for quick passes, one after another (typing)', async () => {
    const { pending, searching } = setup()
    for (let i = 0; i < 5; i++) {
      pending.value = true
      await nextTick()
      await vi.advanceTimersByTimeAsync(SEARCHING_DELAY_MS / 2)
      pending.value = false
      await nextTick()
    }
    await vi.advanceTimersByTimeAsync(SEARCHING_DELAY_MS * 2)
    expect(searching()).toBe(false)
  })

  it('starts the delay when created during a pass and stops its timer with the scope', async () => {
    const { searching } = setup(true)
    expect(searching()).toBe(false)
    await vi.advanceTimersByTimeAsync(SEARCHING_DELAY_MS)
    expect(searching()).toBe(true)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
