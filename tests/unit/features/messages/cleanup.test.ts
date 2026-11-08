/**
 * HEALTH-06 / KNOWN-PRUNE: per-connection module state of the messages and publish features
 * is dropped when the connection is deleted (`notifyConnectionRemoved`, CT-11).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, type EffectScope } from 'vue'
import { useAutoScroll } from '@/features/messages/composables/useAutoScroll'
import { pausedBaselines, usePausedBacklog } from '@/features/messages/composables/usePausedBacklog'
import { rememberedRepeat, rememberRepeat } from '@/features/publish/composables/useRepeatMemory'
import { notifyConnectionRemoved } from '@/stores/connection-lifecycle'
import { useMessagesStore } from '@/stores/messages'
import { message } from '../../renderer/helpers'
import { setupStores } from '../../renderer/stores/setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

let scope: EffectScope

beforeEach(async () => {
  await setupStores()
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('feature state of a deleted connection', () => {
  it('forgets the auto-scroll override', () => {
    const autoScroll = scope.run(() => useAutoScroll('gone'))
    autoScroll?.set(false)
    expect(autoScroll?.enabled.value).toBe(false)
    notifyConnectionRemoved('gone')
    expect(scope.run(() => useAutoScroll('gone'))?.enabled.value).toBe(true)
  })

  it('forgets the paused backlog baseline', async () => {
    const messages = useMessagesStore()
    messages.ingest([message({ connectionId: 'gone' })])
    messages.setPaused('gone', true)
    const backlog = scope.run(() => usePausedBacklog('gone'))
    await nextTick()
    expect(pausedBaselines.has('gone')).toBe(true)
    messages.ingest([message({ connectionId: 'gone' }), message({ connectionId: 'gone' })])
    expect(backlog?.value).toBe(2)
    notifyConnectionRemoved('gone')
    expect(pausedBaselines.has('gone')).toBe(false)
  })

  it('forgets the remembered repeat settings', () => {
    rememberRepeat('gone', { intervalMs: 250, count: 7 })
    rememberRepeat('kept', { intervalMs: 500, count: 3 })
    notifyConnectionRemoved('gone')
    expect(rememberedRepeat('gone')).toEqual({ intervalMs: 1_000, count: 0 })
    expect(rememberedRepeat('kept')).toEqual({ intervalMs: 500, count: 3 })
  })
})
