import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createSubscription } from '@shared/defaults'
import { useConnectionsStore } from '@/stores/connections'
import { useSessionsStore } from '@/stores/sessions'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { useUiStore } from '@/stores/ui'
import { message, settle } from '../helpers'
import { setupStores, type StoreSetup } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

describe('useSubscriptionsStore', () => {
  let setup: StoreSetup
  let id: string

  beforeEach(async () => {
    vi.clearAllMocks()
    setup = await setupStores([{ name: 'Broker' }])
    id = setup.profiles[0].id
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function connect(): void {
    useSessionsStore().handleStatus({ connectionId: id, status: 'connected', timestamp: 1 })
  }

  it('validates new subscriptions', async () => {
    const store = useSubscriptionsStore()
    await expect(store.add(id, createSubscription({ topic: 'a/#/b' }))).rejects.toThrow(
      "'#' must be the last level and occupy the whole level"
    )
    await expect(store.add(id, createSubscription({ topic: '   ' }))).rejects.toThrow(
      'Topic filter is required'
    )
    await expect(
      store.add(id, createSubscription({ topic: 'a', subscriptionIdentifier: 0 }))
    ).rejects.toThrow(/Subscription identifier/)
    expect(setup.bridge.api.connections.save).not.toHaveBeenCalled()
  })

  it('persists a new subscription without subscribing while disconnected', async () => {
    const store = useSubscriptionsStore()
    const sub = await store.add(id, createSubscription({ topic: ' sensors/# ' }))
    expect(sub.topic).toBe('sensors/#')
    expect(store.list(id).map((s) => s.topic)).toEqual(['sensors/#'])
    expect(setup.bridge.stored[0].subscriptions).toHaveLength(1)
    expect(setup.bridge.api.mqtt.subscribe).not.toHaveBeenCalled()
  })

  it('inserts at a given position and moves subscriptions (saved on the profile)', async () => {
    const store = useSubscriptionsStore()
    const a = await store.add(id, createSubscription({ topic: 'a' }))
    const b = await store.add(id, createSubscription({ topic: 'b' }))
    const c = await store.add(id, createSubscription({ topic: 'c' }), { index: 1 })
    const ids = (): string[] => store.list(id).map((sub) => sub.id)
    expect(ids()).toEqual([a.id, c.id, b.id])

    await store.move(id, a.id, 2)
    expect(ids()).toEqual([c.id, b.id, a.id])
    await store.move(id, a.id, -5)
    expect(ids()).toEqual([a.id, c.id, b.id])
    expect(
      useConnectionsStore()
        .get(id)
        ?.subscriptions.map((sub) => sub.id)
    ).toEqual(ids())
    await expect(store.move(id, 'missing', 0)).rejects.toThrow('Subscription not found')
  })

  it('rejects duplicate topic filters', async () => {
    const store = useSubscriptionsStore()
    await store.add(id, createSubscription({ topic: 'a/b' }))
    await expect(store.add(id, createSubscription({ topic: 'a/b' }))).rejects.toThrow(
      'A subscription for "a/b" already exists'
    )
    expect(store.list(id)).toHaveLength(1)
  })

  it('subscribes live when connected and tracks the state', async () => {
    const store = useSubscriptionsStore()
    connect()
    const sub = await store.add(id, createSubscription({ topic: 'a/#', qos: 1 }))
    expect(setup.bridge.api.mqtt.subscribe).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ id: sub.id, topic: 'a/#', qos: 1 })
    )
    expect(store.stateOf(id, sub.id)).toMatchObject({ state: 'subscribed', grantedQos: 1 })
    expect(store.isLive(id, sub.id)).toBe(true)

    const disabled = await store.add(id, createSubscription({ topic: 'b', enabled: false }))
    expect(store.stateOf(id, disabled.id)).toBeUndefined()
  })

  it('marks failed subscribes and shows a toast', async () => {
    const store = useSubscriptionsStore()
    connect()
    vi.mocked(setup.bridge.api.mqtt.subscribe).mockRejectedValueOnce(new Error('Not authorized'))
    const sub = await store.add(id, createSubscription({ topic: 'secret/#' }))
    expect(store.stateOf(id, sub.id)).toMatchObject({ state: 'failed', error: 'Not authorized' })
    expect(toast.error).toHaveBeenCalledWith('Could not subscribe to secret/#', {
      description: 'Not authorized'
    })
  })

  it('re-subscribes when a live field changes and not for cosmetic changes', async () => {
    const store = useSubscriptionsStore()
    connect()
    const sub = await store.add(id, createSubscription({ topic: 'a' }))
    vi.mocked(setup.bridge.api.mqtt.subscribe).mockClear()

    await store.update(id, { ...sub, alias: 'Alpha', color: '#000000' })
    expect(setup.bridge.api.mqtt.unsubscribe).not.toHaveBeenCalled()
    expect(store.get(id, sub.id)?.alias).toBe('Alpha')

    await store.update(id, { ...sub, topic: 'b' })
    expect(setup.bridge.api.mqtt.unsubscribe).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ topic: 'a' })
    )
    expect(setup.bridge.api.mqtt.subscribe).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ topic: 'b' })
    )
    expect(store.stateOf(id, sub.id)?.state).toBe('subscribed')
  })

  it('enables and disables subscriptions live', async () => {
    const store = useSubscriptionsStore()
    connect()
    const sub = await store.add(id, createSubscription({ topic: 'a' }))
    await expect(store.setEnabled(id, sub.id, false)).resolves.toBe(true)
    expect(setup.bridge.api.mqtt.unsubscribe).toHaveBeenCalledTimes(1)
    expect(store.stateOf(id, sub.id)?.state).toBe('idle')
    vi.mocked(setup.bridge.api.mqtt.subscribe).mockClear()
    await store.setEnabled(id, sub.id, true)
    expect(setup.bridge.api.mqtt.subscribe).toHaveBeenCalledTimes(1)
    await expect(store.setEnabled(id, sub.id, true)).resolves.toBe(true)
    await expect(store.setEnabled(id, 'missing', true)).resolves.toBe(false)
  })

  it('removes subscriptions (unsubscribing live ones) and clears filters using them', async () => {
    const store = useSubscriptionsStore()
    const ui = useUiStore()
    connect()
    const sub = await store.add(id, createSubscription({ topic: 'a' }))
    ui.updateMessageFilter(id, { subscriptionId: sub.id })
    await expect(store.remove(id, sub.id)).resolves.toBe(true)
    expect(setup.bridge.api.mqtt.unsubscribe).toHaveBeenCalledTimes(1)
    expect(store.list(id)).toEqual([])
    expect(store.stateOf(id, sub.id)).toBeUndefined()
    expect(ui.messageFilter(id).subscriptionId).toBeNull()
    await expect(store.remove(id, sub.id)).resolves.toBe(true)
  })

  it('colors topics with the first matching enabled subscription (cached)', async () => {
    const store = useSubscriptionsStore()
    await store.add(id, createSubscription({ topic: 'home/#', color: '#111111', enabled: false }))
    const second = await store.add(
      id,
      createSubscription({ topic: 'home/+/temp', color: '#222222' })
    )
    await store.add(id, createSubscription({ topic: '#', color: '#333333' }))
    expect(store.colorForTopic(id, 'home/kitchen/temp')).toBe('#222222')
    expect(store.colorForTopic(id, 'office')).toBe('#333333')
    expect(store.colorForTopic(id, '$SYS/x')).toBeUndefined()
    expect(store.colorForTopic('other', 'home')).toBeUndefined()

    // A profile change produces a new subscriptions array: the cache follows.
    await store.update(id, { ...second, color: '#444444' })
    expect(store.colorForTopic(id, 'home/kitchen/temp')).toBe('#444444')
    expect(store.subscriptionForTopic(id, 'home/kitchen/temp')?.id).toBe(second.id)
  })

  it('ignores a repeated copy of the known event', () => {
    const store = useSubscriptionsStore()
    const event = {
      connectionId: id,
      subscriptionId: 's',
      topic: 't',
      state: 'subscribed' as const,
      grantedQos: 1,
      timestamp: 10
    }
    store.handleEvent(event)
    const known = store.stateOf(id, 's')
    store.handleEvent({ ...event })
    expect(store.stateOf(id, 's')).toBe(known)
    // A different state with the same timestamp still applies.
    store.handleEvent({ ...event, state: 'failed', error: 'Refused by the broker' })
    expect(store.stateOf(id, 's')).toMatchObject({
      state: 'failed',
      error: 'Refused by the broker'
    })
  })

  it('ignores events older than the known state', () => {
    const store = useSubscriptionsStore()
    const base = { connectionId: id, subscriptionId: 's', topic: 't' }
    store.handleEvent({ ...base, state: 'subscribed', timestamp: 10 })
    store.handleEvent({ ...base, state: 'pending', timestamp: 5 })
    expect(store.stateOf(id, 's')?.state).toBe('subscribed')
  })

  it('unsubscribes orphans the broker reports for removed subscriptions', async () => {
    const store = useSubscriptionsStore()
    store.handleEvent({
      connectionId: id,
      subscriptionId: 'removed-meanwhile',
      topic: 'old/#',
      state: 'subscribed',
      timestamp: 1
    })
    await settle()
    expect(setup.bridge.api.mqtt.unsubscribe).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ id: 'removed-meanwhile', topic: 'old/#' })
    )
    expect(store.stateOf(id, 'removed-meanwhile')?.state).toBe('idle')
  })

  it('drops an orphan once, even when its unsubscribe resolves with a known event', async () => {
    const store = useSubscriptionsStore()
    const event = {
      connectionId: id,
      subscriptionId: 'orphan',
      topic: 'old/#',
      state: 'subscribed' as const,
      timestamp: 1
    }
    // A superseded unsubscribe resolves with a copy of the state the main process knew then.
    vi.mocked(setup.bridge.api.mqtt.unsubscribe).mockResolvedValueOnce({ ...event })
    store.handleEvent(event)
    store.handleEvent({ ...event }) // the same event again (e.g. a request result)
    await settle()
    expect(setup.bridge.api.mqtt.unsubscribe).toHaveBeenCalledTimes(1)
    expect(store.stateOf(id, 'orphan')?.state).toBe('subscribed')
    // ...also after the cleanup settled: events and request results are not ordered.
    store.handleEvent({ ...event })
    await settle()
    expect(setup.bridge.api.mqtt.unsubscribe).toHaveBeenCalledTimes(1)

    // The final state still arrives as an event.
    store.handleEvent({ ...event, state: 'idle', timestamp: 2 })
    expect(store.stateOf(id, 'orphan')?.state).toBe('idle')
  })

  it('does not retry an orphan unsubscribe the broker refused', async () => {
    const store = useSubscriptionsStore()
    const event = {
      connectionId: id,
      subscriptionId: 'orphan',
      topic: 'old/#',
      state: 'subscribed' as const,
      timestamp: 1
    }
    vi.mocked(setup.bridge.api.mqtt.unsubscribe).mockResolvedValueOnce({
      ...event,
      error: 'Unsubscribe refused: not authorized',
      timestamp: 2
    })
    store.handleEvent(event)
    await settle()
    expect(setup.bridge.api.mqtt.unsubscribe).toHaveBeenCalledTimes(1)
    expect(store.stateOf(id, 'orphan')?.error).toBe('Unsubscribe refused: not authorized')
  })

  it('reconciles changes made while connecting once connected', async () => {
    vi.useFakeTimers()
    const store = useSubscriptionsStore()
    const sessions = useSessionsStore()
    sessions.handleStatus({ connectionId: id, status: 'connecting', timestamp: 1 })
    const sub = await store.add(id, createSubscription({ topic: 'late/#' }))
    expect(setup.bridge.api.mqtt.subscribe).not.toHaveBeenCalled()

    sessions.handleStatus({ connectionId: id, status: 'connected', timestamp: 2 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(setup.bridge.api.mqtt.subscribe).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ id: sub.id })
    )
    expect(useConnectionsStore().get(id)?.subscriptions).toHaveLength(1)
  })

  it('does not re-subscribe what the main process already subscribed after connecting', async () => {
    vi.useFakeTimers()
    const store = useSubscriptionsStore()
    const sessions = useSessionsStore()
    sessions.handleStatus({ connectionId: id, status: 'reconnecting', timestamp: 1 })
    const sub = await store.add(id, createSubscription({ topic: 'x' }))
    sessions.handleStatus({ connectionId: id, status: 'connected', timestamp: 2 })
    store.handleEvent({
      connectionId: id,
      subscriptionId: sub.id,
      topic: 'x',
      state: 'subscribed',
      timestamp: Date.now()
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(setup.bridge.api.mqtt.subscribe).not.toHaveBeenCalled()
  })

  describe('attribution by MQTT 5 subscription identifier (CT-19)', () => {
    async function overlapping(): Promise<{ wide: string; narrow: string }> {
      const wide = createSubscription({
        topic: 'p/ov/#',
        subscriptionIdentifier: 7,
        color: '#111111'
      })
      const narrow = createSubscription({
        topic: 'p/ov/+',
        subscriptionIdentifier: 8,
        color: '#222222'
      })
      await useConnectionsStore().patch(id, (draft) => {
        draft.subscriptions = [wide, narrow]
      })
      return { wide: wide.id, narrow: narrow.id }
    }

    it('maps a message to the subscription named by its identifier', async () => {
      const ids = await overlapping()
      const store = useSubscriptionsStore()
      const forEight = message({
        connectionId: id,
        topic: 'p/ov/a',
        properties: { subscriptionIdentifier: [8] }
      })
      expect(store.subscriptionForMessage(id, forEight)?.id).toBe(ids.narrow)
      expect(store.colorForMessage(id, forEight)).toBe('#222222')
      const forSeven = message({
        connectionId: id,
        topic: 'p/ov/a',
        properties: { subscriptionIdentifier: [7] }
      })
      expect(store.subscriptionForMessage(id, forSeven)?.id).toBe(ids.wide)
      // One copy for both (HiveMQ): the subscription listed first wins.
      const both = message({
        connectionId: id,
        topic: 'p/ov/a',
        properties: { subscriptionIdentifier: [8, 7] }
      })
      expect(store.subscriptionForMessage(id, both)?.id).toBe(ids.wide)
    })

    it('falls back to the topic match without (known) identifiers', async () => {
      const ids = await overlapping()
      const store = useSubscriptionsStore()
      const plain = message({ connectionId: id, topic: 'p/ov/a' })
      expect(store.subscriptionForMessage(id, plain)?.id).toBe(ids.wide)
      const stale = message({
        connectionId: id,
        topic: 'p/ov/a',
        properties: { subscriptionIdentifier: [99] }
      })
      expect(store.subscriptionForMessage(id, stale)?.id).toBe(ids.wide)
      expect(store.subscriptionForTopic(id, 'p/ov/a')?.id).toBe(ids.wide)
      expect(store.colorForTopic(id, 'p/ov/a')).toBe('#111111')
    })

    it('ignores disabled subscriptions', async () => {
      const ids = await overlapping()
      await useConnectionsStore().patch(id, (draft) => {
        draft.subscriptions[1].enabled = false
      })
      const store = useSubscriptionsStore()
      const forEight = message({
        connectionId: id,
        topic: 'p/ov/a',
        properties: { subscriptionIdentifier: [8] }
      })
      expect(store.subscriptionForMessage(id, forEight)?.id).toBe(ids.wide)
    })
  })
})
