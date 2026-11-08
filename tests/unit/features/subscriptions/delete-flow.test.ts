import { describe, expect, it, vi } from 'vitest'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}))
vi.mock('vue-sonner', () => ({ toast: Object.assign(vi.fn(), toastMock) }))

import { createSubscription } from '@shared/defaults'
import { useSubscriptionActions } from '@/features/subscriptions/composables/useSubscriptionActions'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { useSubscriptionsStore, useUiStore } from '@/stores'
import { settle } from '../../renderer/helpers'
import { setupStores } from '../../renderer/stores/setup'

const SUBS = ['a/#', 'b/#', 'c/#'].map((topic) => createSubscription({ topic }))

describe('deleting a subscription (UX-19, A11Y-21)', () => {
  it('deletes without a confirm and offers Undo for the action toast duration', async () => {
    const { profiles } = await setupStores([{ name: 'A', subscriptions: SUBS }])
    const id = profiles[0].id
    const ui = useUiStore()
    const confirm = vi.spyOn(ui, 'confirm')
    const confirmDestructive = vi.spyOn(ui, 'confirmDestructive')
    const subscriptions = useSubscriptionsStore()
    const target = subscriptions.list(id)[1]

    expect(await useSubscriptionActions(id).remove(target)).toBe(true)

    expect(confirm).not.toHaveBeenCalled()
    expect(confirmDestructive).not.toHaveBeenCalled()
    expect(subscriptions.list(id).map((sub) => sub.topic)).toEqual(['a/#', 'c/#'])
    expect(toastMock.success).toHaveBeenCalledWith(
      'Subscription deleted',
      expect.objectContaining({
        description: 'b/#',
        duration: ACTION_TOAST_DURATION,
        action: expect.objectContaining({ label: 'Undo' })
      })
    )
  })

  it('Undo restores the subscription with its id at its former position', async () => {
    const { profiles } = await setupStores([{ name: 'A', subscriptions: SUBS }])
    const id = profiles[0].id
    const subscriptions = useSubscriptionsStore()
    const target = subscriptions.list(id)[1]
    toastMock.success.mockClear()
    await useSubscriptionActions(id).remove(target)
    const options = toastMock.success.mock.calls[0][1] as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    await settle()
    expect(subscriptions.list(id).map((sub) => [sub.id, sub.topic])).toEqual(
      SUBS.map((sub) => [sub.id, sub.topic])
    )
  })
})
