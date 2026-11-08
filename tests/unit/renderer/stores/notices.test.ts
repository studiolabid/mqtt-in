import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { initApp } from '@/app/bootstrap'
import { unregisterIpcListeners } from '@/app/ipc-listeners'
import { flushStartupProblems, storageNoticeTitle } from '@/app/notices'
import { STICKY_TOAST_DURATION } from '@/lib/toast-options'
import { settle, storageNotice } from '../helpers'
import { disposeStores, setupStores } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  })
}))

function testRouter(): Router {
  const component = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'welcome', component },
      { path: '/connections/:id', name: 'connection', component },
      { path: '/settings', name: 'settings', component }
    ]
  })
  void router.push('/')
  return router
}

describe('storage notices (CT-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    unregisterIpcListeners()
    disposeStores()
    vi.unstubAllGlobals()
  })

  it('bootstrap toasts each startup notice once mounted, with a Show file action', async () => {
    const { bridge } = await setupStores()
    const corrupt = storageNotice({ path: 'C:\\data\\connections.corrupt-2026.json' })
    bridge.notices.push(corrupt)
    await initApp(testRouter())
    expect(bridge.api.app.getStorageNotices).toHaveBeenCalled()
    // vue-sonner drops toasts created before the Toaster is mounted: queued until then.
    expect(toast.warning).not.toHaveBeenCalled()
    flushStartupProblems()
    expect(toast.warning).toHaveBeenCalledWith('Saved connections could not be read', {
      id: 'storage-notice:corrupt:connections.json',
      description: corrupt.message,
      duration: STICKY_TOAST_DURATION,
      action: { label: 'Show file', onClick: expect.any(Function) }
    })
    const options = vi.mocked(toast.warning).mock.calls[0][1] as { action: { onClick(): void } }
    options.action.onClick()
    expect(bridge.api.app.showItemInFolder).toHaveBeenCalledWith(corrupt.path)

    // The same notice pushed live as well (subscribed before the fetch) is not shown twice.
    for (const listener of bridge.listeners.storageNotice) listener(corrupt)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows later notices as errors (no action without a path)', async () => {
    const { bridge } = await setupStores()
    await initApp(testRouter())
    flushStartupProblems()
    const failed = storageNotice({
      kind: 'write-failed',
      file: 'storage.json',
      message: 'The publish history could not be saved: EACCES',
      timestamp: 5
    })
    for (const listener of bridge.listeners.storageNotice) listener(failed)
    expect(toast.error).toHaveBeenCalledWith('Changes could not be saved', {
      id: 'storage-notice:write-failed:storage.json',
      description: failed.message,
      duration: STICKY_TOAST_DURATION,
      action: undefined
    })
  })

  it('keeps showing the app when the notices cannot be read', async () => {
    const { bridge } = await setupStores()
    vi.mocked(bridge.api.app.getStorageNotices).mockRejectedValueOnce(new Error('no handler'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(initApp(testRouter())).resolves.toBeUndefined()
    await settle()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('titles every kind (per file)', () => {
    const title = (
      kind: Parameters<typeof storageNoticeTitle>[0]['kind'],
      file = 'connections.json'
    ): string => storageNoticeTitle({ kind, file })
    expect(title('unreadable')).toBe('Saved connections could not be read')
    expect(title('corrupt')).toBe('Saved connections could not be read')
    expect(title('restored-backup')).toBe('Saved connections restored from backup')
    expect(title('invalid-entries')).toBe('Some saved connections were invalid')
    expect(title('write-failed')).toBe('Changes could not be saved')
    expect(title('secrets-unavailable')).toBe('Saved passwords cannot be decrypted')
    expect(title('corrupt', 'settings.json')).toBe('Settings could not be read')
    expect(title('invalid-entries', 'other.json')).toBe('Some entries of other.json were invalid')
  })
})
