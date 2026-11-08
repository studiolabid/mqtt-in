import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { notifyConnectionRemoved } from '@/stores/connection-lifecycle'
import { useMessagesStore } from '@/stores/messages'
import { useUiStore } from '@/stores/ui'
import { messages } from '../helpers'
import { setupStores } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

describe('useUiStore().unreadCount (CT-12)', () => {
  beforeEach(async () => {
    await setupStores()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('counts incoming messages of a connection that is not shown', () => {
    const ui = useUiStore()
    useMessagesStore().ingest(messages(5, { connectionId: 'b' }))
    expect(ui.unreadCount('b')).toBe(5)
    expect(ui.unreadCount('never-seen')).toBe(0)
  })

  it('is 0 while the workspace is shown, also when messages arrive', () => {
    const ui = useUiStore()
    const store = useMessagesStore()
    store.ingest(messages(5, { connectionId: 'b' }))
    ui.setShownConnection('b')
    expect(ui.shownConnectionId).toBe('b')
    expect(ui.unreadCount('b')).toBe(0)
    store.ingest(messages(7, { connectionId: 'b' }))
    expect(ui.unreadCount('b')).toBe(0)
  })

  it('counts again from the moment the workspace was left', () => {
    const ui = useUiStore()
    const store = useMessagesStore()
    ui.setShownConnection('b')
    store.ingest(messages(4, { connectionId: 'b' }))
    ui.setShownConnection('a')
    expect(ui.unreadCount('b')).toBe(0)
    store.ingest(messages(3, { connectionId: 'b' }))
    expect(ui.unreadCount('b')).toBe(3)
    ui.setShownConnection(null) // e.g. the settings page
    expect(ui.unreadCount('a')).toBe(0)
    expect(ui.unreadCount('b')).toBe(3)
  })

  it('ignores outgoing messages and resets with clear()', () => {
    const ui = useUiStore()
    const store = useMessagesStore()
    store.ingest(messages(2, { connectionId: 'b', direction: 'out' }))
    expect(ui.unreadCount('b')).toBe(0)
    store.ingest(messages(6, { connectionId: 'b' }))
    expect(ui.unreadCount('b')).toBe(6)
    store.clear('b')
    expect(ui.unreadCount('b')).toBe(0)
    store.ingest(messages(1, { connectionId: 'b' }))
    expect(ui.unreadCount('b')).toBe(1)

    // Seen before a clear: the old mark does not hide new messages.
    ui.setShownConnection('b')
    ui.setShownConnection(null)
    store.clear('b')
    store.ingest(messages(2, { connectionId: 'b' }))
    expect(ui.unreadCount('b')).toBe(2)
  })

  it('is reactive', () => {
    const ui = useUiStore()
    const count = computed(() => ui.unreadCount('b'))
    expect(count.value).toBe(0)
    useMessagesStore().ingest(messages(2, { connectionId: 'b' }))
    expect(count.value).toBe(2)
    ui.setShownConnection('b')
    expect(count.value).toBe(0)
  })

  it('is pruned with the connection', () => {
    const ui = useUiStore()
    const store = useMessagesStore()
    ui.setShownConnection('b')
    store.ingest(messages(2, { connectionId: 'b' }))
    notifyConnectionRemoved('b')
    expect(ui.shownConnectionId).toBeNull()
    expect(ui.unreadCount('b')).toBe(0)
  })
})
