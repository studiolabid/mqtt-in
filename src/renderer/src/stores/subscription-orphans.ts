/**
 * Orphan cleanup: the broker reports a subscription the loaded profile no longer has (e.g.
 * removed while its session was reconnecting), so it is unsubscribed quietly.
 * Internal helper of `useSubscriptionsStore`.
 */
import type { SubscriptionEvent } from '@shared/models'
import { createSubscription } from '@shared/defaults'
import { api } from '@/services/api'

export interface OrphanCleanerDeps {
  /** True when the loaded profile of the event's connection lacks the subscription. */
  isOrphan(event: SubscriptionEvent): boolean
  /** Applies the state the unsubscribe resolved with. */
  apply(event: SubscriptionEvent): void
}

/**
 * Returns `drop(event)`, which unsubscribes an orphan reported `subscribed`. At most one
 * unsubscribe per subscription is in flight, so a refused or overtaken unsubscribe (which
 * resolves `subscribed`) is never retried in a loop.
 */
export function createOrphanCleaner(deps: OrphanCleanerDeps): (event: SubscriptionEvent) => void {
  const inFlight = new Set<string>()
  return (event) => {
    if (!deps.isOrphan(event)) return
    const key = `${event.connectionId}\u0000${event.subscriptionId}`
    if (inFlight.has(key)) return
    inFlight.add(key)
    const orphan = createSubscription({ id: event.subscriptionId, topic: event.topic })
    void Promise.resolve()
      .then(() => api.mqtt.unsubscribe(event.connectionId, orphan))
      .then(deps.apply)
      .catch((err: unknown) => {
        console.warn(`[mqtey] could not drop orphan subscription ${event.topic}:`, err)
      })
      .finally(() => inFlight.delete(key))
  }
}
