import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { onConnectionRemoved } from '@/stores/connection-lifecycle'
import { useConnectionsStore } from '@/stores/connections'
import { useLogsStore } from '@/stores/logs'
import { useMessagesStore } from '@/stores/messages'
import { usePinsStore } from '@/stores/pins'
import { usePublishStore } from '@/stores/publish'
import { useSessionsStore } from '@/stores/sessions'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { useUiStore } from '@/stores/ui'
import { EMPTY_STATS } from '@/types'
import { importResult, message, settle } from '../helpers'
import { setupStores } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  })
}))

describe('useConnectionsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the saved profiles in persisted order', async () => {
    const { profiles } = await setupStores([{ name: 'B' }, { name: 'A' }])
    const store = useConnectionsStore()
    expect(store.loaded).toBe(true)
    expect(store.profiles.map((p) => p.name)).toEqual(['B', 'A'])
    expect(store.get(profiles[1].id)?.name).toBe('A')
    expect(store.get('missing')).toBeUndefined()
    await expect(store.whenLoaded()).resolves.toBeUndefined()
  })

  it('groups profiles: ungrouped first, then groups in natural order', async () => {
    await setupStores([
      { name: 'a', group: 'Prod 10' },
      { name: 'b', group: '' },
      { name: 'c', group: 'prod 2' },
      { name: 'd', group: ' Prod 10 ' }
    ])
    const store = useConnectionsStore()
    expect(store.groups.map((g) => [g.name, g.profiles.map((p) => p.name)])).toEqual([
      ['', ['b']],
      ['prod 2', ['c']],
      ['Prod 10', ['a', 'd']]
    ])
    expect(store.groupNames).toEqual(['prod 2', 'Prod 10'])
  })

  it('creates unsaved drafts with unique names and fresh ids', async () => {
    const { bridge } = await setupStores([{ name: 'Connection 2' }])
    const store = useConnectionsStore()
    const draft = store.create()
    expect(draft.name).toBe('Connection 3')
    expect(bridge.api.connections.save).not.toHaveBeenCalled()

    const sub = createSubscription({ topic: 'x/#' })
    const preset = store.create({
      id: 'fixed',
      name: 'Connection 2',
      host: 'broker.hivemq.com',
      tls: { rejectUnauthorized: false } as never,
      subscriptions: [sub]
    })
    expect(preset.id).not.toBe('fixed')
    expect(preset.name).toBe('Connection 2 2')
    expect(preset.host).toBe('broker.hivemq.com')
    expect(preset.tls.rejectUnauthorized).toBe(false)
    expect(preset.tls.alpnProtocols).toEqual([])
    expect(preset.subscriptions[0].topic).toBe('x/#')
    expect(preset.subscriptions[0].id).not.toBe(sub.id)
  })

  it('saves (upserts) and returns the stored profile', async () => {
    const { bridge } = await setupStores()
    const store = useConnectionsStore()
    const draft = store.create({ name: 'Local' })
    const saved = await store.save(draft)
    expect(saved).toBe(store.get(draft.id))
    expect(store.profiles).toHaveLength(1)
    await store.save({ ...draft, name: 'Renamed' })
    expect(store.profiles).toHaveLength(1)
    expect(store.get(draft.id)?.name).toBe('Renamed')
    expect(bridge.stored[0].name).toBe('Renamed')
  })

  it('rejects save errors with a short message', async () => {
    const { bridge } = await setupStores()
    const store = useConnectionsStore()
    vi.mocked(bridge.api.connections.save).mockRejectedValueOnce(
      new Error("Error invoking remote method 'connections:save': Error: Host is required")
    )
    await expect(store.save(store.create())).rejects.toThrow(/^Host is required$/)
    expect(store.profiles).toHaveLength(0)
  })

  it('serializes patches so concurrent edits are never lost', async () => {
    const { profiles } = await setupStores([{ name: 'p' }])
    const store = useConnectionsStore()
    const id = profiles[0].id
    await Promise.all([
      store.patch(id, (draft) => {
        draft.name = 'renamed'
      }),
      store.patch(id, (draft) => {
        draft.group = 'G'
      }),
      store.patch(id, (draft) => ({ ...draft, port: 1884 }))
    ])
    expect(store.get(id)).toMatchObject({ name: 'renamed', group: 'G', port: 1884 })
    await expect(store.patch('missing', () => undefined)).rejects.toThrow('Connection not found')
  })

  it('records lastConnectedAt and never lets an older copy undo it', async () => {
    const { profiles } = await setupStores([{ name: 'p' }])
    const store = useConnectionsStore()
    const staleCopy = structuredClone(profiles[0])
    store.touchLastConnected(profiles[0].id, 5000)
    expect(store.get(profiles[0].id)?.lastConnectedAt).toBe(5000)
    await store.save(staleCopy)
    expect(store.get(profiles[0].id)?.lastConnectedAt).toBe(5000)
  })

  it('removes a profile (main disconnects it) and drops its state in every store', async () => {
    const { bridge, profiles } = await setupStores([
      { name: 'p', subscriptions: [createSubscription({ topic: 'a/#' })] },
      { name: 'q' }
    ])
    const store = useConnectionsStore()
    const id = profiles[0].id
    const subId = profiles[0].subscriptions[0].id
    const other = profiles[1].id
    const sessions = useSessionsStore()
    const messages = useMessagesStore()
    const logs = useLogsStore()
    const publish = usePublishStore()
    const subscriptions = useSubscriptionsStore()
    const ui = useUiStore()
    const pins = usePinsStore()
    sessions.handleStatus({ connectionId: id, status: 'connected', rttMs: 9, timestamp: 1 })
    subscriptions.handleEvent({
      connectionId: id,
      subscriptionId: subId,
      topic: 'a/#',
      state: 'subscribed',
      timestamp: 1
    })
    messages.ingest([
      message({ connectionId: id, topic: 'a/1', payload: new TextEncoder().encode('5') })
    ])
    messages.setPaused(id, true)
    logs.add(id, 'info', 'hello')
    await settle()
    publish.draft(id).topic = 'changed'
    ui.setWorkspaceTab(id, 'logs')
    ui.selectMessage(id, 1)
    ui.updateMessageFilter(id, { search: 'x' })
    ui.requestMessageExport(id, 'csv')
    ui.setShownConnection(other)
    expect(pins.pin(id, 'a/1', '')).not.toBeNull()
    expect(ui.unreadCount(id)).toBe(1)
    messages.ingest([message({ connectionId: other })])

    await expect(store.remove(id)).resolves.toBe(true)
    // The main process disconnects a live session as part of the delete.
    expect(bridge.api.mqtt.disconnect).not.toHaveBeenCalled()
    expect(bridge.api.connections.remove).toHaveBeenCalledWith(id)
    expect(store.profiles.map((p) => p.name)).toEqual(['q'])
    expect(messages.count(id)).toBe(0)
    expect(messages.revision(id)).toBe(0)
    expect(messages.stats(id)).toEqual(EMPTY_STATS)
    expect(messages.isPaused(id)).toBe(false)
    expect(messages.topicTree(id).size).toBe(0)
    expect(logs.entries(id)).toEqual([])
    expect(logs.revision(id)).toBe(0)
    expect(publish.history(id)).toEqual([])
    expect(publish.draft(id).topic).toBe('mqtt-in/test')
    expect(subscriptions.stateOf(id, subId)).toBeUndefined()
    expect(sessions.statusOf(id)).toBe('disconnected')
    expect(sessions.rttMs(id)).toBeUndefined()
    expect(ui.workspaceTab(id)).toBe('messages')
    expect(ui.selectedMessageId(id)).toBeNull()
    expect(ui.messageFilter(id).search).toBe('')
    expect(ui.messageExportRequest(id)).toBeNull()
    expect(ui.unreadCount(id)).toBe(0)
    expect(pins.list(id)).toEqual([])
    expect(pins.revision(id)).toBe(0)
    // The other connection keeps its state.
    expect(messages.count(other)).toBe(1)
  })

  it('keeps the profile and shows a toast when removing fails', async () => {
    const { bridge, profiles } = await setupStores([{ name: 'p' }])
    const store = useConnectionsStore()
    vi.mocked(bridge.api.connections.remove).mockRejectedValueOnce(new Error('locked'))
    const cleanup = vi.fn()
    const unregister = onConnectionRemoved(cleanup)
    await expect(store.remove(profiles[0].id)).resolves.toBe(false)
    unregister()
    expect(store.profiles).toHaveLength(1)
    expect(cleanup).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Could not delete the connection', {
      description: 'locked'
    })
  })

  it('duplicates with new ids right after the original', async () => {
    const source = createConnectionProfile({
      name: 'Broker',
      clientId: 'mqttin_0a1b2c3d',
      lastConnectedAt: 9,
      subscriptions: [createSubscription({ topic: 'a/#' })]
    })
    const { bridge } = await setupStores([source, { name: 'Other' }])
    const store = useConnectionsStore()
    const copy = await store.duplicate(source.id)
    expect(copy).not.toBeNull()
    expect(copy?.id).not.toBe(source.id)
    expect(copy?.name).toBe('Broker copy')
    expect(copy?.clientId).toMatch(/^mqttin_[0-9a-f]{8}$/)
    expect(copy?.clientId).not.toBe(source.clientId)
    expect(copy?.lastConnectedAt).toBeUndefined()
    expect(copy?.subscriptions[0].topic).toBe('a/#')
    expect(copy?.subscriptions[0].id).not.toBe(source.subscriptions[0].id)
    expect(store.profiles.map((p) => p.name)).toEqual(['Broker', 'Broker copy', 'Other'])
    expect(bridge.api.connections.reorder).toHaveBeenCalled()
    expect((await store.duplicate(source.id))?.name).toBe('Broker copy 2')
  })

  it('keeps custom client ids when duplicating', async () => {
    const source = createConnectionProfile({ name: 'AWS', clientId: 'thing-1' })
    await setupStores([source])
    expect((await useConnectionsStore().duplicate(source.id))?.clientId).toBe('thing-1')
  })

  it('reorders optimistically and rolls back on failure', async () => {
    const { bridge, profiles } = await setupStores([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    const store = useConnectionsStore()
    const [a, b, c] = profiles.map((p) => p.id)
    await store.reorder([c, a])
    expect(store.profiles.map((p) => p.name)).toEqual(['c', 'a', 'b'])
    expect(bridge.api.connections.reorder).toHaveBeenCalledWith([c, a, b])

    vi.mocked(bridge.api.connections.reorder).mockRejectedValueOnce(new Error('io'))
    await store.reorder([b, 'unknown'])
    expect(store.profiles.map((p) => p.name)).toEqual(['c', 'a', 'b'])
    expect(toast.error).toHaveBeenCalled()

    vi.mocked(bridge.api.connections.reorder).mockClear()
    await store.reorder([c, a, b])
    expect(bridge.api.connections.reorder).not.toHaveBeenCalled()
  })

  it('imports profiles from a file', async () => {
    const { bridge } = await setupStores([{ name: 'existing' }])
    const store = useConnectionsStore()
    expect(await store.importFromFile()).toBe(0)
    const imported = [
      createConnectionProfile({ name: 'i1' }),
      createConnectionProfile({ name: 'i2' })
    ]
    vi.mocked(bridge.api.connections.importFromFile).mockResolvedValueOnce(
      importResult({ imported })
    )
    expect(await store.importFromFile()).toBe(2)
    expect(store.profiles.map((p) => p.name)).toEqual(['existing', 'i1', 'i2'])
    expect(toast.success).toHaveBeenCalledWith('Imported 2 connections', {
      description: undefined
    })
    vi.mocked(bridge.api.connections.importFromFile).mockRejectedValueOnce(new Error('bad file'))
    expect(await store.importFromFile()).toBe(0)
    expect(toast.error).toHaveBeenCalledWith('Import failed', { description: 'bad file' })
  })

  it('exports profiles to a file', async () => {
    const { bridge, profiles } = await setupStores([{ name: 'a' }, { name: 'b' }])
    const store = useConnectionsStore()
    expect(await store.exportToFile()).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
    vi.mocked(bridge.api.connections.exportToFile).mockResolvedValueOnce('C:/out.json')
    expect(await store.exportToFile([profiles[0].id])).toBe('C:/out.json')
    expect(bridge.api.connections.exportToFile).toHaveBeenLastCalledWith(
      [profiles[0].id],
      undefined
    )
    expect(toast.success).toHaveBeenCalledWith('Exported 1 connection', {
      description: 'out.json',
      action: { label: 'Show in folder', onClick: expect.any(Function) },
      duration: ACTION_TOAST_DURATION
    })
  })
})
