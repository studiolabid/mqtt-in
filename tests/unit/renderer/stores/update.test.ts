import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { toast } from 'vue-sonner'
import type { UpdateState } from '@shared/models'
import { flushStartupProblems } from '@/app/notices'
import { UPDATE_TOAST_ID, watchUpdateReady } from '@/app/update-notices'
import { registerIpcListeners, unregisterIpcListeners } from '@/app/ipc-listeners'
import { ACTION_TOAST_DURATION, STICKY_TOAST_DURATION } from '@/lib/toast-options'
import { useUpdateStore } from '@/stores/update'
import { disposeStores, setupStores } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  })
}))

const ready: UpdateState = { phase: 'ready', currentVersion: '1.2.0', version: '1.3.0' }

describe('update store', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    unregisterIpcListeners()
    disposeStores()
  })

  it('says when the version is the latest', async () => {
    const { bridge } = await setupStores()
    vi.mocked(bridge.api.update.check).mockResolvedValueOnce({
      phase: 'up-to-date',
      currentVersion: '1.2.0'
    })
    await useUpdateStore().check()
    expect(toast.success).toHaveBeenCalledWith('You have the latest version', {
      description: 'mqtt-in 1.2.0'
    })
  })

  it('links the releases when this build cannot update itself', async () => {
    const { bridge } = await setupStores()
    vi.mocked(bridge.api.update.check).mockResolvedValueOnce({
      phase: 'unsupported',
      currentVersion: '1.2.0',
      message: 'Development build'
    })
    await useUpdateStore().check()
    expect(toast.info).toHaveBeenCalledWith('Automatic updates are not available', {
      description: 'Development build',
      duration: ACTION_TOAST_DURATION,
      action: { label: 'Open releases', onClick: expect.any(Function) }
    })
  })

  it('follows pushed states and announces a ready version once, with Restart now', async () => {
    const { bridge } = await setupStores()
    registerIpcListeners()
    watchUpdateReady()
    flushStartupProblems()
    for (const listener of bridge.listeners.update) listener(ready)
    await nextTick()
    for (const listener of bridge.listeners.update) listener({ ...ready })
    await nextTick()
    expect(useUpdateStore().ready).toBe(true)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('mqtt-in 1.3.0 is ready to install', {
      id: UPDATE_TOAST_ID,
      description: 'Restart to update. Your connections, settings and history stay as they are.',
      duration: STICKY_TOAST_DURATION,
      action: { label: 'Restart now', onClick: expect.any(Function) },
      cancel: { label: "What's new", onClick: expect.any(Function) }
    })
    const options = vi.mocked(toast.success).mock.calls[0][1] as { action: { onClick(): void } }
    options.action.onClick()
    expect(bridge.api.update.install).toHaveBeenCalledOnce()
  })

  it('reports a failed install', async () => {
    const { bridge } = await setupStores()
    vi.mocked(bridge.api.update.install).mockRejectedValueOnce(new Error('No update is ready'))
    expect(await useUpdateStore().install()).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Could not install the update', {
      description: 'No update is ready'
    })
  })
})
