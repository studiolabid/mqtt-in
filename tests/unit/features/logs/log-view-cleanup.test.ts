import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() })
}))

import { useLogView } from '@/features/logs/composables/useLogView'
import { notifyConnectionRemoved } from '@/stores'
import { setupStores } from '../../renderer/stores/setup'

describe('log view state cleanup (HEALTH-06)', () => {
  it('drops the view state of a deleted connection', async () => {
    await setupStores()
    const view = useLogView('c1')
    view.search.value = 'refused'
    view.levels.value = ['error']
    view.autoScroll.value = false
    // Kept per connection while it exists (the panel remounts with every workspace switch).
    expect(useLogView('c1').search.value).toBe('refused')

    notifyConnectionRemoved('c1')

    const fresh = useLogView('c1')
    expect(fresh.search.value).toBe('')
    expect(fresh.levels.value).toEqual(['info', 'warn', 'error'])
    expect(fresh.autoScroll.value).toBe(true)
  })

  it('keeps the views of other connections', async () => {
    await setupStores()
    useLogView('c1').search.value = 'one'
    useLogView('c2').search.value = 'two'
    notifyConnectionRemoved('c1')
    expect(useLogView('c2').search.value).toBe('two')
  })
})
