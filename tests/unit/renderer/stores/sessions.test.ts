import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { useConnectionsStore } from '@/stores/connections'
import { usePublishStore } from '@/stores/publish'
import { useSessionsStore } from '@/stores/sessions'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { brokerInfo, settle } from '../helpers'
import { setupStores, type StoreSetup } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

describe('useSessionsStore', () => {
  let setup: StoreSetup
  let id: string

  beforeEach(async () => {
    vi.clearAllMocks()
    setup = await setupStores([{ name: 'Broker' }])
    id = setup.profiles[0].id
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports unknown sessions as disconnected', () => {
    const store = useSessionsStore()
    expect(store.get('x')).toEqual({ connectionId: 'x', status: 'disconnected', updatedAt: 0 })
    expect(store.isConnected('x')).toBe(false)
    expect(store.isBusy('x')).toBe(false)
  })

  it('connects optimistically', async () => {
    const store = useSessionsStore()
    const pending = store.connect(id)
    expect(store.statusOf(id)).toBe('connecting')
    expect(store.isBusy(id)).toBe(true)
    await expect(pending).resolves.toBe(true)
    expect(setup.bridge.api.mqtt.connect).toHaveBeenCalledWith(id)
  })

  it('shows the error when a connect cannot start', async () => {
    const store = useSessionsStore()
    vi.mocked(setup.bridge.api.mqtt.connect).mockRejectedValueOnce(
      new Error("Error invoking remote method 'mqtt:connect': Error: Invalid URL")
    )
    await expect(store.connect(id)).resolves.toBe(false)
    expect(store.get(id)).toMatchObject({ status: 'error', error: 'Invalid URL' })
    expect(toast.error).toHaveBeenCalledWith('Could not connect to Broker', {
      description: 'Invalid URL'
    })
  })

  it('refuses unknown profiles and ignores connects of active sessions', async () => {
    const store = useSessionsStore()
    await expect(store.connect('missing')).resolves.toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Connection not found')
    store.handleStatus({ connectionId: id, status: 'connected', timestamp: 1 })
    await expect(store.connect(id)).resolves.toBe(true)
    expect(setup.bridge.api.mqtt.connect).not.toHaveBeenCalled()
  })

  it('applies status events and records lastConnectedAt locally (main persists it)', async () => {
    const store = useSessionsStore()
    store.handleStatus({
      connectionId: id,
      status: 'connected',
      clientId: 'mqtey_1',
      connectedAt: 1234,
      sessionPresent: false,
      timestamp: 1240
    })
    expect(store.get(id)).toEqual({
      connectionId: id,
      status: 'connected',
      error: undefined,
      clientId: 'mqtey_1',
      connectedAt: 1234,
      updatedAt: 1240
    })
    expect(store.connectedIds).toEqual([id])
    await settle()
    expect(useConnectionsStore().get(id)?.lastConnectedAt).toBe(1234)
    // The main process records lastConnectedAt on CONNACK itself (without bumping updatedAt).
    expect(setup.bridge.api.connections.save).not.toHaveBeenCalled()

    // A reconnect moves it forward; an older timestamp never moves it back.
    store.handleStatus({ connectionId: id, status: 'reconnecting', timestamp: 1300 })
    store.handleStatus({
      connectionId: id,
      status: 'connected',
      connectedAt: 2000,
      timestamp: 2000
    })
    expect(useConnectionsStore().get(id)?.lastConnectedAt).toBe(2000)
    useConnectionsStore().touchLastConnected(id, 1500)
    expect(useConnectionsStore().get(id)?.lastConnectedAt).toBe(2000)
    await settle()
    expect(setup.bridge.api.connections.save).not.toHaveBeenCalled()
  })

  it('resets subscription states when the connection is lost', () => {
    const store = useSessionsStore()
    const subscriptions = useSubscriptionsStore()
    store.handleStatus({ connectionId: id, status: 'connected', timestamp: 1 })
    subscriptions.handleEvent({
      connectionId: id,
      subscriptionId: 's1',
      topic: '#',
      state: 'subscribed',
      timestamp: 2
    })
    store.handleStatus({ connectionId: id, status: 'reconnecting', error: 'lost', timestamp: 3 })
    expect(subscriptions.stateOf(id, 's1')).toBeUndefined()
    expect(store.get(id)).toMatchObject({ status: 'reconnecting', error: 'lost' })
    expect(store.get(id).connectedAt).toBeUndefined()
  })

  it('toasts a connection error once', () => {
    const store = useSessionsStore()
    store.handleStatus({ connectionId: id, status: 'error', error: 'Not authorized', timestamp: 1 })
    store.handleStatus({ connectionId: id, status: 'error', error: 'Not authorized', timestamp: 2 })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Broker: connection failed', {
      description: 'Not authorized'
    })
  })

  it('disconnects and never stays stuck in disconnecting', async () => {
    const store = useSessionsStore()
    await expect(store.disconnect(id)).resolves.toBe(true)
    expect(setup.bridge.api.mqtt.disconnect).not.toHaveBeenCalled()

    store.handleStatus({ connectionId: id, status: 'connected', timestamp: 1 })
    const pending = store.disconnect(id)
    expect(store.statusOf(id)).toBe('disconnecting')
    await pending
    expect(store.statusOf(id)).toBe('disconnected')
  })

  it('reconnects: disconnects a live session first, connects an idle one directly', async () => {
    const store = useSessionsStore()
    await expect(store.reconnect(id)).resolves.toBe(true)
    expect(setup.bridge.api.mqtt.disconnect).not.toHaveBeenCalled()
    expect(setup.bridge.api.mqtt.connect).toHaveBeenCalledTimes(1)

    store.handleStatus({ connectionId: id, status: 'connected', timestamp: 2 })
    await expect(store.reconnect(id)).resolves.toBe(true)
    expect(setup.bridge.api.mqtt.disconnect).toHaveBeenCalledWith(id)
    expect(setup.bridge.api.mqtt.connect).toHaveBeenCalledTimes(2)
    expect(store.statusOf(id)).toBe('connecting')
  })

  it('does not reconnect when the disconnect fails', async () => {
    const store = useSessionsStore()
    store.handleStatus({ connectionId: id, status: 'connected', timestamp: 2 })
    vi.mocked(setup.bridge.api.mqtt.disconnect).mockRejectedValueOnce(new Error('busy'))
    await expect(store.reconnect(id)).resolves.toBe(false)
    expect(setup.bridge.api.mqtt.connect).not.toHaveBeenCalled()
  })

  it('restores the previous status when disconnecting fails', async () => {
    const store = useSessionsStore()
    store.handleStatus({ connectionId: id, status: 'connected', timestamp: 1 })
    vi.mocked(setup.bridge.api.mqtt.disconnect).mockRejectedValueOnce(new Error('busy'))
    await expect(store.disconnect(id)).resolves.toBe(false)
    expect(store.statusOf(id)).toBe('connected')
    expect(toast.error).toHaveBeenCalledWith('Could not disconnect Broker', { description: 'busy' })
  })

  it('toggles between connect and disconnect', async () => {
    const store = useSessionsStore()
    await store.toggle(id)
    expect(setup.bridge.api.mqtt.connect).toHaveBeenCalledTimes(1)
    await store.toggle(id) // still "connecting": cancels the attempt
    expect(setup.bridge.api.mqtt.disconnect).toHaveBeenCalledTimes(1)
    store.handleStatus({ connectionId: id, status: 'disconnecting', timestamp: Date.now() + 10 })
    await expect(store.toggle(id)).resolves.toBe(false)
  })

  it('hydrates sessions, subscription states and repeat jobs', () => {
    const store = useSessionsStore()
    store.hydrate([
      {
        connectionId: id,
        status: 'connected',
        clientId: 'c',
        connectedAt: 10,
        subscriptions: [
          { connectionId: id, subscriptionId: 's', topic: 't', state: 'subscribed', timestamp: 5 }
        ],
        repeatJobs: [
          {
            jobId: 'j',
            connectionId: id,
            topic: 't',
            state: 'running',
            sent: 3,
            total: 0,
            intervalMs: 100,
            timestamp: 6
          }
        ]
      }
    ])
    expect(store.get(id)).toMatchObject({ status: 'connected', clientId: 'c', connectedAt: 10 })
    expect(useSubscriptionsStore().stateOf(id, 's')?.state).toBe('subscribed')
    expect(usePublishStore().activeJobFor(id)?.jobId).toBe('j')
  })

  it('forgets a session', () => {
    const store = useSessionsStore()
    store.handleStatus({ connectionId: id, status: 'connected', timestamp: 1 })
    store.forget(id)
    expect(store.statusOf(id)).toBe('disconnected')
  })

  describe('broker info and RTT (CT-16)', () => {
    it('keeps the broker facts of a connected status event', () => {
      const store = useSessionsStore()
      const broker = brokerInfo({ maximumQoS: 1 })
      store.handleStatus({ connectionId: id, status: 'connected', broker, timestamp: 10 })
      expect(store.brokerInfo(id)).toEqual(broker)
      expect(store.rttMs(id)).toBeUndefined()
    })

    it('updates the RTT from an event carrying only rttMs (keeping the rest)', () => {
      const store = useSessionsStore()
      const broker = brokerInfo()
      store.handleStatus({
        connectionId: id,
        status: 'connected',
        broker,
        connectedAt: 10,
        clientId: 'mqtey_0a1b2c3d',
        timestamp: 10
      })
      store.handleStatus({ connectionId: id, status: 'connected', rttMs: 34, timestamp: 5_000 })
      expect(store.rttMs(id)).toBe(34)
      expect(store.brokerInfo(id)).toEqual(broker)
      expect(store.get(id)).toMatchObject({ connectedAt: 10, clientId: 'mqtey_0a1b2c3d' })
      store.handleStatus({ connectionId: id, status: 'connected', rttMs: 51, timestamp: 10_000 })
      expect(store.rttMs(id)).toBe(51)
    })

    it("clears both when the status leaves 'connected'", () => {
      const store = useSessionsStore()
      store.handleStatus({
        connectionId: id,
        status: 'connected',
        broker: brokerInfo(),
        rttMs: 20,
        timestamp: 1
      })
      store.handleStatus({ connectionId: id, status: 'reconnecting', timestamp: 2 })
      expect(store.brokerInfo(id)).toBeUndefined()
      expect(store.rttMs(id)).toBeUndefined()
      expect(store.get(id).broker).toBeUndefined()
      // A new CONNACK without broker facts does not resurrect the old ones.
      store.handleStatus({ connectionId: id, status: 'connected', timestamp: 3 })
      expect(store.brokerInfo(id)).toBeUndefined()
    })

    it('drops them on a local disconnect too', async () => {
      const store = useSessionsStore()
      store.handleStatus({
        connectionId: id,
        status: 'connected',
        broker: brokerInfo(),
        rttMs: 20,
        timestamp: 1
      })
      await store.disconnect(id)
      expect(store.brokerInfo(id)).toBeUndefined()
      expect(store.rttMs(id)).toBeUndefined()
    })

    it('restores them from session snapshots (renderer reload)', () => {
      const store = useSessionsStore()
      const broker = brokerInfo({ protocolVersion: 4, receiveMaximum: undefined })
      store.hydrate([
        {
          connectionId: id,
          status: 'connected',
          connectedAt: 5,
          broker,
          rttMs: 12,
          subscriptions: [],
          repeatJobs: []
        },
        {
          connectionId: 'other',
          status: 'reconnecting',
          broker: brokerInfo(),
          rttMs: 99,
          subscriptions: [],
          repeatJobs: []
        }
      ])
      expect(store.brokerInfo(id)).toEqual(broker)
      expect(store.rttMs(id)).toBe(12)
      expect(store.brokerInfo('other')).toBeUndefined()
      expect(store.rttMs('other')).toBeUndefined()
    })
  })
})
