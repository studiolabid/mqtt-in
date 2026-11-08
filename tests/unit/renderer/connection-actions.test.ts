import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  })
}))

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ name: 'welcome', params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(async () => undefined), back: vi.fn() })
}))

import { toast } from 'vue-sonner'
import { useConnectionActions } from '@/composables/useConnectionActions'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { useConnectionsStore, useUiStore } from '@/stores'
import { setupStores } from './stores/setup'

describe('useConnectionActions().duplicate (CT-30)', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
  })

  it('offers "Edit" on the copy for ACTION_TOAST_DURATION', async () => {
    const { profiles } = await setupStores([{ name: 'Lab' }])
    await useConnectionActions().duplicate(profiles[0].id)

    const copy = useConnectionsStore().profiles.find((profile) => profile.name === 'Lab copy')
    expect(copy).toBeDefined()
    expect(toast.success).toHaveBeenCalledTimes(1)
    const [title, options] = vi.mocked(toast.success).mock.calls[0]
    expect(title).toBe('Duplicated as “Lab copy”')
    expect(options).toMatchObject({ duration: ACTION_TOAST_DURATION, action: { label: 'Edit' } })

    // The handler ignores its click event.
    const action = (options as { action: { onClick: () => void } }).action
    action.onClick()
    expect(useUiStore().connectionDialog).toMatchObject({ open: true, editingId: copy?.id })
  })
})
