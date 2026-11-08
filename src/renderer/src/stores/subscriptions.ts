/**
 * Subscription use cases: persisted on the profile, applied live when connected.
 *
 * Live states (`pending` / `subscribed` / `failed` / `idle`) come from the main process.
 * Changes made while a session is (re)connecting are reconciled shortly after CONNACK
 * (`./subscription-live`), and subscriptions the broker still holds but the profile no longer
 * has are unsubscribed (`./subscription-orphans`). Messages are attributed to subscriptions by
 * MQTT 5 subscription identifier first, then by topic (`subscriptionForMessage`,
 * `./subscription-match`).
 */
import { defineStore } from 'pinia'
import { onScopeDispose, ref, toRaw } from 'vue'
import { toast } from 'vue-sonner'
import type { MqttMessage, Subscription, SubscriptionEvent } from '@shared/models'
import { errorMessage } from '@/services/api'
import { toPlain } from '@/utils/plain'
import {
  assertUniqueFilter,
  liveFieldsChanged,
  prepareSubscription,
  sameSubscriptionEvent
} from '@/utils/subscription'
import { onConnectionRemoved } from './connection-lifecycle'
import { useConnectionsStore } from './connections'
import { useSessionsStore } from './sessions'
import { createLiveSubscriptions } from './subscription-live'
import { createSubscriptionMatcher } from './subscription-match'
import { createOrphanCleaner } from './subscription-orphans'
import { useUiStore } from './ui'

const EMPTY: Subscription[] = []

export const useSubscriptionsStore = defineStore('subscriptions', () => {
  /** Live state per connection id → subscription id. */
  const states = ref<Record<string, Record<string, SubscriptionEvent>>>({})
  /** Message / topic → subscription, cached per subscriptions array (identity). */
  const matcher = createSubscriptionMatcher()
  /** Live requests, and the changes made while connecting (reconciled after CONNACK). */
  const live = createLiveSubscriptions({
    apply: (event) => handleEvent(event),
    get: (connectionId, subscriptionId) => get(connectionId, subscriptionId),
    isLive: (connectionId, subscriptionId) => isLive(connectionId, subscriptionId),
    statusOf: (connectionId) => useSessionsStore().statusOf(connectionId)
  })
  /** The broker holds a subscription the (loaded) profile no longer has: drop it quietly. */
  const dropOrphan = createOrphanCleaner({
    isOrphan: (event) => {
      const profile = useConnectionsStore().get(event.connectionId)
      return !!profile && !profile.subscriptions.some((sub) => sub.id === event.subscriptionId)
    },
    apply: (event) => handleEvent(event)
  })
  onScopeDispose(onConnectionRemoved(forget))

  /** Subscriptions of a profile (persisted order). Do not mutate: use the actions. */
  function list(connectionId: string): Subscription[] {
    return useConnectionsStore().get(connectionId)?.subscriptions ?? EMPTY
  }

  function get(connectionId: string, subscriptionId: string): Subscription | undefined {
    return list(connectionId).find((sub) => sub.id === subscriptionId)
  }

  /** Last known live state (`undefined` = never subscribed in this session). */
  function stateOf(connectionId: string, subscriptionId: string): SubscriptionEvent | undefined {
    return states.value[connectionId]?.[subscriptionId]
  }

  /** Subscribed or a subscribe request is in flight. */
  function isLive(connectionId: string, subscriptionId: string): boolean {
    const state = stateOf(connectionId, subscriptionId)?.state
    return state === 'subscribed' || state === 'pending'
  }

  /**
   * Adds a subscription to the profile (at the end, or at `options.index`) and subscribes it
   * when connected and enabled. Rejects with a human message when invalid, duplicated or not
   * saved.
   */
  async function add(
    connectionId: string,
    input: Subscription,
    options: { index?: number } = {}
  ): Promise<Subscription> {
    const sub = prepareSubscription(input)
    await useConnectionsStore().patch(connectionId, (draft) => {
      if (draft.subscriptions.some((other) => other.id === sub.id)) {
        throw new Error('This subscription already exists')
      }
      assertUniqueFilter(draft.subscriptions, sub)
      const at = options.index ?? draft.subscriptions.length
      draft.subscriptions.splice(Math.max(0, Math.min(at, draft.subscriptions.length)), 0, sub)
    })
    if (sub.enabled) await live.goLive(connectionId, sub)
    return sub
  }

  /**
   * Saves a changed subscription. When connected and a live field changed (topic, QoS,
   * enabled, MQTT 5 options) the old filter is unsubscribed and the new one subscribed.
   */
  async function update(connectionId: string, input: Subscription): Promise<Subscription> {
    const next = prepareSubscription(input)
    const captured: { previous?: Subscription } = {}
    await useConnectionsStore().patch(connectionId, (draft) => {
      const index = draft.subscriptions.findIndex((sub) => sub.id === next.id)
      if (index === -1) throw new Error('Subscription not found')
      assertUniqueFilter(draft.subscriptions, next)
      captured.previous = draft.subscriptions[index]
      draft.subscriptions[index] = next
    })
    const previous = captured.previous
    if (previous && liveFieldsChanged(previous, next)) {
      await live.applyLiveChange(connectionId, previous, next)
    }
    return next
  }

  /** Moves a subscription to `index` in the list (saved on the profile; nothing goes live). */
  async function move(connectionId: string, subscriptionId: string, index: number): Promise<void> {
    await useConnectionsStore().patch(connectionId, (draft) => {
      const from = draft.subscriptions.findIndex((sub) => sub.id === subscriptionId)
      if (from === -1) throw new Error('Subscription not found')
      const [sub] = draft.subscriptions.splice(from, 1)
      draft.subscriptions.splice(Math.max(0, Math.min(index, draft.subscriptions.length)), 0, sub)
    })
  }

  /**
   * Unsubscribes (when live) and removes the subscription from the profile.
   *
   * @returns false (after a toast) when it could not be saved.
   */
  async function remove(connectionId: string, subscriptionId: string): Promise<boolean> {
    const sub = get(connectionId, subscriptionId)
    if (!sub) return true
    if (useSessionsStore().isConnected(connectionId) && isLive(connectionId, subscriptionId)) {
      await live.unsubscribeLive(connectionId, toPlain(sub))
    }
    try {
      await useConnectionsStore().patch(connectionId, (draft) => {
        draft.subscriptions = draft.subscriptions.filter((other) => other.id !== subscriptionId)
      })
    } catch (err) {
      toast.error('Could not remove the subscription', { description: errorMessage(err) })
      return false
    }
    const byConnection = states.value[connectionId]
    if (byConnection) delete byConnection[subscriptionId]
    live.dropPending(connectionId, subscriptionId)
    useUiStore().dropSubscriptionReferences(connectionId, subscriptionId)
    return true
  }

  /**
   * Enables / disables a subscription (subscribes / unsubscribes when connected).
   *
   * @returns false (after a toast) on failure.
   */
  async function setEnabled(
    connectionId: string,
    subscriptionId: string,
    enabled: boolean
  ): Promise<boolean> {
    const sub = get(connectionId, subscriptionId)
    if (!sub) return false
    if (sub.enabled === enabled) return true
    try {
      await update(connectionId, { ...toPlain(sub), enabled })
      return true
    } catch (err) {
      toast.error('Could not update the subscription', { description: errorMessage(err) })
      return false
    }
  }

  /**
   * Applies a live state event from the main process. Older events are ignored, and so are
   * repeats of the known one (requests resolve with a copy of an event already received).
   */
  function handleEvent(event: SubscriptionEvent): void {
    if (!states.value[event.connectionId]) states.value[event.connectionId] = {}
    // Re-read through the reactive proxy (an assignment expression yields the raw object).
    const byConnection = states.value[event.connectionId]
    const current = byConnection[event.subscriptionId]
    if (current && (current.timestamp > event.timestamp || sameSubscriptionEvent(current, event))) {
      return
    }
    byConnection[event.subscriptionId] = { ...event }
    if (event.state === 'subscribed') dropOrphan(event)
  }

  /** Restores the live states of a session snapshot. */
  function hydrate(connectionId: string, events: readonly SubscriptionEvent[]): void {
    for (const event of events) handleEvent({ ...event, connectionId })
  }

  /** Forgets live states when the session is lost (the main process re-subscribes later). */
  function resetStates(connectionId: string): void {
    delete states.value[connectionId]
  }

  /** Called on CONNACK: reconciles subscriptions changed while connecting. */
  function onConnected(connectionId: string): void {
    live.onConnected(connectionId)
  }

  /** Drops every state of a deleted connection (registered with `onConnectionRemoved`). */
  function forget(connectionId: string): void {
    delete states.value[connectionId]
    live.dropPending(connectionId)
  }

  /** First enabled subscription matching `topic` (topic-only contexts; cached per list). */
  function subscriptionForTopic(connectionId: string, topic: string): Subscription | undefined {
    return matcher.forTopic(toRaw(list(connectionId)), topic)
  }

  /** Color of the first enabled subscription matching `topic`. */
  function colorForTopic(connectionId: string, topic: string): string | undefined {
    return subscriptionForTopic(connectionId, topic)?.color
  }

  /**
   * The subscription a message was delivered for (CT-19): by MQTT 5 subscription identifier
   * (the first listed enabled one), otherwise the first enabled topic match.
   */
  function subscriptionForMessage(
    connectionId: string,
    message: MqttMessage
  ): Subscription | undefined {
    return matcher.forMessage(toRaw(list(connectionId)), message)
  }

  /** Color of `subscriptionForMessage` (message row tags). */
  function colorForMessage(connectionId: string, message: MqttMessage): string | undefined {
    return subscriptionForMessage(connectionId, message)?.color
  }

  return {
    states,
    list,
    get,
    stateOf,
    isLive,
    add,
    update,
    move,
    remove,
    setEnabled,
    handleEvent,
    hydrate,
    resetStates,
    onConnected,
    forget,
    subscriptionForTopic,
    colorForTopic,
    subscriptionForMessage,
    colorForMessage
  }
})
