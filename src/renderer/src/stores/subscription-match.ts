/**
 * Which subscription a message belongs to (CT-19). Internal helper of `useSubscriptionsStore`
 * (pure, no Vue: the store passes raw subscription arrays, which also key the caches).
 *
 * - MQTT 5 subscription identifiers first: a message delivered for subscription identifier 8
 *   belongs to the enabled subscription with identifier 8, even when an earlier subscription's
 *   filter also matches its topic (brokers such as EMQX send one copy per matching
 *   subscription, each with its own identifier; others send one copy with every identifier).
 *   With several identifiers, the subscription listed first wins.
 * - Otherwise (MQTT 3.x, no identifiers, or identifiers of removed subscriptions): the first
 *   enabled subscription whose filter matches the topic (`findMatchingSubscription` of
 *   `@shared/topic`, the rule the main process uses too).
 */
import type { MqttMessage, Subscription } from '@shared/models'
import { findMatchingSubscription } from '@shared/topic'

const MATCH_CACHE_LIMIT = 5000

/** A valid MQTT 5 subscription identifier (1 … 268,435,455). */
export function isSubscriptionIdentifier(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** The subscription identifiers a message was delivered with (empty when none). */
export function messageSubscriptionIds(message: MqttMessage): readonly number[] {
  return message.properties?.subscriptionIdentifier ?? []
}

export interface SubscriptionMatcher {
  /** First enabled subscription whose filter matches `topic` (cached per list and topic). */
  forTopic(subs: readonly Subscription[], topic: string): Subscription | undefined
  /** The enabled subscription named by the message's identifiers, else `forTopic`. */
  forMessage(subs: readonly Subscription[], message: MqttMessage): Subscription | undefined
}

interface IdentifierEntry {
  sub: Subscription
  position: number
}

/** Caches are keyed by the subscriptions array (a saved profile gets a new array). */
export function createSubscriptionMatcher(): SubscriptionMatcher {
  const topicCache = new WeakMap<object, Map<string, Subscription | undefined>>()
  const identifierIndex = new WeakMap<object, Map<number, IdentifierEntry>>()

  function forTopic(subs: readonly Subscription[], topic: string): Subscription | undefined {
    if (subs.length === 0) return undefined
    let cache = topicCache.get(subs)
    if (!cache) {
      cache = new Map()
      topicCache.set(subs, cache)
    }
    if (cache.has(topic)) return cache.get(topic)
    const match = findMatchingSubscription(subs, topic)
    if (cache.size >= MATCH_CACHE_LIMIT) cache.clear()
    cache.set(topic, match)
    return match
  }

  /** Enabled subscriptions by identifier (the first listed one per identifier). */
  function indexOf(subs: readonly Subscription[]): Map<number, IdentifierEntry> {
    const known = identifierIndex.get(subs)
    if (known) return known
    const index = new Map<number, IdentifierEntry>()
    subs.forEach((sub, position) => {
      const id = sub.subscriptionIdentifier
      if (sub.enabled && isSubscriptionIdentifier(id) && !index.has(id)) {
        index.set(id, { sub, position })
      }
    })
    identifierIndex.set(subs, index)
    return index
  }

  function forMessage(
    subs: readonly Subscription[],
    message: MqttMessage
  ): Subscription | undefined {
    const ids = messageSubscriptionIds(message)
    if (ids.length > 0 && subs.length > 0) {
      const index = indexOf(subs)
      let best: IdentifierEntry | undefined
      for (const id of ids) {
        const entry = index.get(id)
        if (entry && (!best || entry.position < best.position)) best = entry
      }
      if (best) return best.sub
    }
    return forTopic(subs, message.topic)
  }

  return { forTopic, forMessage }
}
