/**
 * Live side of the subscriptions of a connection: subscribe / unsubscribe requests with their
 * optimistic and final states and the error toasts, and the changes made while a session is
 * (re)connecting, which are reconciled shortly after CONNACK. Internal helper of
 * `useSubscriptionsStore` (the publish-repeat.ts / subscription-orphans.ts pattern).
 */
import { toast } from 'vue-sonner'
import type { ConnectionStatus, Subscription, SubscriptionEvent } from '@shared/models'
import { api, errorMessage } from '@/services/api'
import { toPlain } from '@/utils/plain'

/** Delay after CONNACK before reconciling (the main process auto-subscribes first). */
export const RECONCILE_DELAY_MS = 1500

export interface LiveRequests {
  /** Marks the subscription `pending`, subscribes and applies the outcome (toast on failure). */
  subscribeLive(connectionId: string, sub: Subscription): Promise<boolean>
  /** Unsubscribes and applies the outcome (toast on failure). */
  unsubscribeLive(connectionId: string, sub: Subscription): Promise<boolean>
}

/** @param apply applies a live state event (the store's `handleEvent`). */
export function createLiveRequests(apply: (event: SubscriptionEvent) => void): LiveRequests {
  async function subscribeLive(connectionId: string, sub: Subscription): Promise<boolean> {
    apply({
      connectionId,
      subscriptionId: sub.id,
      topic: sub.topic,
      state: 'pending',
      timestamp: Date.now()
    })
    try {
      apply(await api.mqtt.subscribe(connectionId, sub))
      return true
    } catch (err) {
      const message = errorMessage(err)
      apply({
        connectionId,
        subscriptionId: sub.id,
        topic: sub.topic,
        state: 'failed',
        error: message,
        timestamp: Date.now()
      })
      toast.error(`Could not subscribe to ${sub.topic}`, { description: message })
      return false
    }
  }

  async function unsubscribeLive(connectionId: string, sub: Subscription): Promise<boolean> {
    try {
      apply(await api.mqtt.unsubscribe(connectionId, sub))
      return true
    } catch (err) {
      toast.error(`Could not unsubscribe from ${sub.topic}`, { description: errorMessage(err) })
      return false
    }
  }

  return { subscribeLive, unsubscribeLive }
}

/** What the live side needs from the stores. */
export interface LiveSubscriptionsDeps {
  /** Applies a live state event (the store's `handleEvent`). */
  apply(event: SubscriptionEvent): void
  /** The saved subscription (the store's `get`). */
  get(connectionId: string, subscriptionId: string): Subscription | undefined
  /** Subscribed, or a subscribe request is in flight (the store's `isLive`). */
  isLive(connectionId: string, subscriptionId: string): boolean
  /** The session status (the sessions store's `statusOf`). */
  statusOf(connectionId: string): ConnectionStatus
}

export interface LiveSubscriptions extends LiveRequests {
  /** Subscribes a saved subscription now (connected) or after CONNACK (connecting). */
  goLive(connectionId: string, sub: Subscription): Promise<void>
  /** Applies a saved change live: unsubscribes the old filter and subscribes the new one. */
  applyLiveChange(connectionId: string, previous: Subscription, next: Subscription): Promise<void>
  /** Remembers a change made while the session was (re)connecting. */
  markPending(connectionId: string, subscriptionId: string): void
  /** Forgets the pending changes of one subscription, or of the whole connection. */
  dropPending(connectionId: string, subscriptionId?: string): void
  /** Called on CONNACK: reconciles the pending changes after `RECONCILE_DELAY_MS`. */
  onConnected(connectionId: string): void
}

export function createLiveSubscriptions(deps: LiveSubscriptionsDeps): LiveSubscriptions {
  const requests = createLiveRequests(deps.apply)
  const { subscribeLive, unsubscribeLive } = requests
  /** Subscriptions changed while their session was (re)connecting. */
  const pendingLive = new Map<string, Set<string>>()

  function isChanging(status: ConnectionStatus): boolean {
    return status === 'connecting' || status === 'reconnecting'
  }

  async function goLive(connectionId: string, sub: Subscription): Promise<void> {
    const status = deps.statusOf(connectionId)
    if (status === 'connected') await subscribeLive(connectionId, sub)
    else if (isChanging(status)) markPending(connectionId, sub.id)
  }

  async function applyLiveChange(
    connectionId: string,
    previous: Subscription,
    next: Subscription
  ): Promise<void> {
    const status = deps.statusOf(connectionId)
    if (isChanging(status)) {
      markPending(connectionId, next.id)
      return
    }
    if (status !== 'connected') return
    if (deps.isLive(connectionId, previous.id)) await unsubscribeLive(connectionId, previous)
    if (next.enabled) await subscribeLive(connectionId, next)
  }

  function markPending(connectionId: string, subscriptionId: string): void {
    let set = pendingLive.get(connectionId)
    if (!set) {
      set = new Set()
      pendingLive.set(connectionId, set)
    }
    set.add(subscriptionId)
  }

  function dropPending(connectionId: string, subscriptionId?: string): void {
    if (subscriptionId === undefined) pendingLive.delete(connectionId)
    else pendingLive.get(connectionId)?.delete(subscriptionId)
  }

  function onConnected(connectionId: string): void {
    const pending = pendingLive.get(connectionId)
    if (!pending || pending.size === 0) return
    pendingLive.delete(connectionId)
    setTimeout(() => reconcile(connectionId, pending), RECONCILE_DELAY_MS)
  }

  /** Subscribes enabled and unsubscribes disabled subscriptions whose live state differs. */
  function reconcile(connectionId: string, ids: ReadonlySet<string>): void {
    if (deps.statusOf(connectionId) !== 'connected') return
    for (const id of ids) {
      const sub = deps.get(connectionId, id)
      if (!sub) continue
      const live = deps.isLive(connectionId, id)
      if (sub.enabled && !live) void subscribeLive(connectionId, toPlain(sub))
      else if (!sub.enabled && live) void unsubscribeLive(connectionId, toPlain(sub))
    }
  }

  return {
    subscribeLive,
    unsubscribeLive,
    goLive,
    applyLiveChange,
    markPending,
    dropPending,
    onConnected
  }
}
