/**
 * HEALTH-08: the topic explorer's "View payload as" is local to its viewer; it never changes
 * the Messages tab (the connection's view format).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { useViewerFormat } from '@/features/topics/composables/useViewerFormat'
import { useUiStore } from '@/stores/ui'
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

describe('useViewerFormat', () => {
  it('never writes the connection view format', () => {
    const ui = useUiStore()
    const setViewFormat = vi.spyOn(ui, 'setViewFormat')
    const format = scope.run(() =>
      useViewerFormat(
        () => 'c1',
        () => 'a/b'
      )
    )
    if (!format) throw new Error('no scope')
    expect(format.value).toBe(ui.viewFormat('c1'))
    format.value = 'hex'
    expect(format.value).toBe('hex')
    expect(setViewFormat).not.toHaveBeenCalled()
    expect(ui.viewFormat('c1')).not.toBe('hex')
  })

  it('follows the connection format until a format is picked, per topic', async () => {
    const ui = useUiStore()
    const topic = ref('a/b')
    const format = scope.run(() =>
      useViewerFormat(
        () => 'c1',
        () => topic.value
      )
    )
    if (!format) throw new Error('no scope')
    ui.setViewFormat('c1', 'json')
    expect(format.value).toBe('json')
    format.value = 'base64'
    topic.value = 'a/c'
    await nextTick()
    expect(format.value).toBe('json')
  })
})
