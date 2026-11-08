import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyConnectionRemoved, onConnectionRemoved } from '@/stores'
import { useConnectionsStore } from '@/stores/connections'
import { useMessagesStore } from '@/stores/messages'
import { message } from '../helpers'
import { disposeStores, setupStores } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

describe('connection lifecycle registry (CT-11)', () => {
  const unregister: Array<() => void> = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const off of unregister.splice(0)) off()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function register(cleanup: (id: string) => void): void {
    unregister.push(onConnectionRemoved(cleanup))
  }

  it('runs every cleanup once main confirmed the delete', async () => {
    const { profiles } = await setupStores([{ name: 'p' }])
    const cleanup = vi.fn()
    register(cleanup)
    await useConnectionsStore().remove(profiles[0].id)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledWith(profiles[0].id)
  })

  it('keeps running the other cleanups when one throws (and logs it)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const before = vi.fn()
    const after = vi.fn()
    register(before)
    register(() => {
      throw new Error('boom')
    })
    register(after)
    notifyConnectionRemoved('c1')
    expect(before).toHaveBeenCalledWith('c1')
    expect(after).toHaveBeenCalledWith('c1')
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toContain('c1')
  })

  it('unregisters, and unregistering twice does nothing', () => {
    const cleanup = vi.fn()
    const off = onConnectionRemoved(cleanup)
    off()
    off()
    notifyConnectionRemoved('c1')
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('calls a function registered twice once per registration', () => {
    const cleanup = vi.fn()
    register(cleanup)
    const second = onConnectionRemoved(cleanup)
    notifyConnectionRemoved('c1')
    expect(cleanup).toHaveBeenCalledTimes(2)
    second()
    notifyConnectionRemoved('c2')
    expect(cleanup).toHaveBeenCalledTimes(3)
  })

  it('lets a cleanup unregister itself while running', () => {
    const later = vi.fn()
    const off = onConnectionRemoved(() => off())
    register(later)
    notifyConnectionRemoved('c1')
    notifyConnectionRemoved('c2')
    expect(later).toHaveBeenCalledTimes(2)
  })

  it('drops the registrations of disposed stores (no pile-up across Pinias)', async () => {
    await setupStores()
    const disposed = useMessagesStore()
    disposed.ingest([message({ connectionId: 'gone' })])
    await setupStores() // disposes the previous Pinia's stores
    const current = useMessagesStore()
    current.ingest([message({ connectionId: 'gone' })])
    notifyConnectionRemoved('gone')
    expect(current.count('gone')).toBe(0)
    // The disposed store no longer listens: its (orphaned) state was not touched.
    expect(disposed.count('gone')).toBe(1)
    disposeStores()
  })
})
