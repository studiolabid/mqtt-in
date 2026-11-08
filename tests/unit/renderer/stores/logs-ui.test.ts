import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '@shared/models'
import { MAX_LOG_ENTRIES, useLogsStore } from '@/stores/logs'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { setupStores } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

function entry(id: number, connectionId = 'c'): LogEntry {
  return { id, connectionId, level: 'info', message: `m${id}`, timestamp: id }
}

describe('useLogsStore', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    await setupStores()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stores entries per connection with a snapshot per revision', async () => {
    const store = useLogsStore()
    expect(store.entries('c')).toEqual([])
    store.handle(entry(1))
    const first = store.entries('c')
    expect(first.map((e) => e.id)).toEqual([1])
    expect(store.entries('c')).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)

    // Revisions are coalesced to one every 100 ms.
    store.handle(entry(2))
    store.handle(entry(3))
    expect(store.entries('c')).toBe(first)
    await vi.advanceTimersByTimeAsync(100)
    expect(store.entries('c').map((e) => e.id)).toEqual([1, 2, 3])
    expect(store.entries('other')).toEqual([])
  })

  it('caps the log and drops the oldest entries in chunks', async () => {
    const store = useLogsStore()
    for (let i = 1; i <= MAX_LOG_ENTRIES + 1; i++) store.handle(entry(i))
    await vi.advanceTimersByTimeAsync(100)
    const entries = store.entries('c')
    expect(entries.length).toBeLessThanOrEqual(MAX_LOG_ENTRIES)
    expect(entries.length).toBeGreaterThan(MAX_LOG_ENTRIES * 0.8)
    expect(entries[entries.length - 1].id).toBe(MAX_LOG_ENTRIES + 1)
  })

  it('adds renderer entries with negative ids and counts levels', async () => {
    const store = useLogsStore()
    const a = store.add('c', 'warn', 'renderer side', 'detail')
    const b = store.add('c', 'error', 'again')
    expect(a.id).toBeLessThan(0)
    expect(b.id).toBeLessThan(a.id)
    expect(a.detail).toBe('detail')
    expect(b).not.toHaveProperty('detail')
    await vi.advanceTimersByTimeAsync(100)
    expect(store.counts('c')).toEqual({ debug: 0, info: 0, warn: 1, error: 1 })
  })

  it('clears and forgets immediately', () => {
    const store = useLogsStore()
    store.handle(entry(1))
    store.clear('c')
    expect(store.entries('c')).toEqual([])
    store.handle(entry(2, 'd'))
    store.forget('d')
    expect(store.entries('d')).toEqual([])
  })
})

describe('useUiStore', () => {
  beforeEach(async () => {
    await setupStores()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens and closes the connection and subscription dialogs', () => {
    const ui = useUiStore()
    ui.openNewConnection({ host: 'broker.emqx.io' })
    expect(ui.connectionDialog).toEqual({
      open: true,
      editingId: null,
      preset: { host: 'broker.emqx.io' }
    })
    ui.openEditConnection('p1')
    expect(ui.connectionDialog).toEqual({ open: true, editingId: 'p1', preset: null })
    ui.closeConnectionDialog()
    expect(ui.connectionDialog.open).toBe(false)

    ui.openNewSubscription('p1', { topic: 'a/#' })
    expect(ui.subscriptionDialog).toEqual({
      open: true,
      connectionId: 'p1',
      editingId: null,
      preset: { topic: 'a/#' },
      multiple: false
    })
    ui.openNewSubscription('p1', undefined, { multiple: true })
    expect(ui.subscriptionDialog).toMatchObject({ editingId: null, preset: null, multiple: true })
    ui.openEditSubscription('p1', 's1')
    expect(ui.subscriptionDialog).toMatchObject({ editingId: 's1', preset: null, multiple: false })
    ui.closeSubscriptionDialog()
    expect(ui.subscriptionDialog.open).toBe(false)
  })

  it('resolves confirms through resolveConfirm', async () => {
    const ui = useUiStore()
    const answer = ui.confirm({ title: 'Delete?' })
    expect(ui.confirmState.open).toBe(true)
    expect(ui.confirmState.options?.title).toBe('Delete?')
    ui.resolveConfirm(true)
    await expect(answer).resolves.toBe(true)
    expect(ui.confirmState.open).toBe(false)
    // The options stay for the exit animation.
    expect(ui.confirmState.options?.title).toBe('Delete?')
  })

  it('answers false to a confirm replaced by another one', async () => {
    const ui = useUiStore()
    const first = ui.confirm({ title: 'one' })
    const second = ui.confirm({ title: 'two' })
    await expect(first).resolves.toBe(false)
    ui.resolveConfirm(true)
    await expect(second).resolves.toBe(true)
  })

  it('skips destructive confirms when confirmBeforeDelete is off', async () => {
    const ui = useUiStore()
    const pending = ui.confirmDestructive({ title: 'Delete connection?' })
    expect(ui.confirmState.options).toMatchObject({ destructive: true, confirmText: 'Delete' })
    ui.resolveConfirm(false)
    await expect(pending).resolves.toBe(false)

    await useSettingsStore().update({ confirmBeforeDelete: false })
    await expect(ui.confirmDestructive({ title: 'x' })).resolves.toBe(true)
  })

  it('keeps workspace state per connection', () => {
    const ui = useUiStore()
    expect(ui.workspaceTab('a')).toBe('messages')
    ui.setWorkspaceTab('a', 'topics')
    expect(ui.workspaceTab('a')).toBe('topics')
    expect(ui.workspaceTab('b')).toBe('messages')

    ui.selectMessage('a', 42)
    ui.selectTopic('a', 'x/y')
    expect(ui.selectedMessageId('a')).toBe(42)
    expect(ui.selectedTopic('a')).toBe('x/y')
    ui.selectMessage('a', null)
    ui.selectTopic('a', null)
    expect(ui.selectedMessageId('a')).toBeNull()
    expect(ui.selectedTopic('a')).toBeNull()
  })

  it('creates reactive message filters on demand', () => {
    const ui = useUiStore()
    const filter = ui.messageFilter('a')
    expect(filter).toEqual({
      direction: 'all',
      topic: '',
      search: '',
      subscriptionId: null,
      retainedOnly: false
    })
    filter.search = 'abc'
    expect(ui.messageFilter('a').search).toBe('abc')
    ui.updateMessageFilter('a', { direction: 'in', subscriptionId: 's' })
    ui.dropSubscriptionReferences('a', 'other')
    expect(ui.messageFilter('a').subscriptionId).toBe('s')
    ui.dropSubscriptionReferences('a', 's')
    expect(ui.messageFilter('a').subscriptionId).toBeNull()
    ui.resetMessageFilter('a')
    expect(ui.messageFilter('a').search).toBe('')
    ui.dropSubscriptionReferences('never-created', 's')
  })

  it('defaults the view format to the setting', async () => {
    const ui = useUiStore()
    expect(ui.viewFormat('a')).toBe('auto')
    await useSettingsStore().update({ defaultViewFormat: 'hex' })
    expect(ui.viewFormat('a')).toBe('hex')
    ui.setViewFormat('a', 'json')
    expect(ui.viewFormat('a')).toBe('json')
  })

  it('navigates between workspace tabs for cross-feature actions', () => {
    const ui = useUiStore()
    ui.showTopic('a', 'x')
    expect(ui.workspaceTab('a')).toBe('topics')
    expect(ui.selectedTopic('a')).toBe('x')
    ui.showMessages('a', { topic: 'x/#' })
    expect(ui.workspaceTab('a')).toBe('messages')
    expect(ui.messageFilter('a').topic).toBe('x/#')
  })

  it('forgets every piece of state of a connection', () => {
    const ui = useUiStore()
    ui.setWorkspaceTab('a', 'logs')
    ui.selectMessage('a', 1)
    ui.messageFilter('a').search = 'x'
    ui.setViewFormat('a', 'hex')
    ui.openEditConnection('a')
    ui.openNewSubscription('a')
    ui.forgetConnection('a')
    expect(ui.workspaceTab('a')).toBe('messages')
    expect(ui.selectedMessageId('a')).toBeNull()
    expect(ui.messageFilter('a').search).toBe('')
    expect(ui.viewFormat('a')).toBe('auto')
    expect(ui.connectionDialog.open).toBe(false)
    expect(ui.subscriptionDialog.open).toBe(false)
  })
})
