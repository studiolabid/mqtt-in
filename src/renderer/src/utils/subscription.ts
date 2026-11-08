/**
 * Subscription validation helpers (pure, no Vue).
 */
import type { Subscription, SubscriptionEvent } from '@shared/models'
import { createSubscription } from '@shared/defaults'
import { validateTopicFilter } from '@shared/topic'
import { toPlain } from './plain'

/** Largest MQTT 5 subscription identifier (variable byte integer). */
export const MAX_SUBSCRIPTION_IDENTIFIER = 268_435_455

/** Fields whose change requires re-subscribing on a live session. */
export const LIVE_SUBSCRIPTION_FIELDS = [
  'topic',
  'qos',
  'enabled',
  'noLocal',
  'retainAsPublished',
  'retainHandling',
  'subscriptionIdentifier'
] as const satisfies readonly (keyof Subscription)[]

/**
 * A complete, plain copy of user input (missing fields defaulted, topic trimmed).
 *
 * @throws Error with a human message when the filter, QoS or identifier is invalid.
 */
export function prepareSubscription(input: Subscription): Subscription {
  const sub = createSubscription({ ...toPlain(input), topic: input.topic.trim() })
  const topicError = validateTopicFilter(sub.topic)
  if (topicError) throw new Error(topicError)
  if (sub.qos !== 0 && sub.qos !== 1 && sub.qos !== 2) throw new Error('QoS must be 0, 1 or 2')
  const identifier = sub.subscriptionIdentifier
  if (
    identifier !== undefined &&
    (!Number.isInteger(identifier) || identifier < 1 || identifier > MAX_SUBSCRIPTION_IDENTIFIER)
  ) {
    throw new Error('Subscription identifier must be an integer between 1 and 268435455')
  }
  return sub
}

/**
 * Two subscriptions with the same filter would collide on the broker (unsubscribing one
 * removes both), so filters must be unique per profile.
 *
 * @throws Error when another subscription of `list` uses the filter of `sub`.
 */
export function assertUniqueFilter(list: readonly Subscription[], sub: Subscription): void {
  if (list.some((other) => other.id !== sub.id && other.topic === sub.topic)) {
    throw new Error(`A subscription for "${sub.topic}" already exists`)
  }
}

/** True when the change from `previous` to `next` must be applied to a live session. */
export function liveFieldsChanged(previous: Subscription, next: Subscription): boolean {
  return LIVE_SUBSCRIPTION_FIELDS.some((field) => previous[field] !== next[field])
}

/**
 * True when two events report the same state change. The main process resolves
 * `subscribe` / `unsubscribe` with a copy of an event it has already emitted.
 */
export function sameSubscriptionEvent(a: SubscriptionEvent, b: SubscriptionEvent): boolean {
  return (
    a.connectionId === b.connectionId &&
    a.subscriptionId === b.subscriptionId &&
    a.timestamp === b.timestamp &&
    a.state === b.state &&
    a.topic === b.topic &&
    a.grantedQos === b.grantedQos &&
    a.error === b.error
  )
}
