/**
 * Message filter predicates for the message list (pure, no Vue). The text search itself lives
 * in `./message-search` (byte-level, no decoding for the common views).
 */
import type { MqttMessage, Subscription, ViewFormat } from '@shared/models'
import { decodePayload } from '@shared/payload'
import { hasWildcard, topicMatches, validateTopicFilter } from '@shared/topic'
import type { MessageFilter } from '@/types'
import type { MessagePredicate } from './filtered-view'
import {
  clearSearchCache,
  createSearchPredicate,
  lowerTopic,
  normalizeSearchTerm,
  SEARCH_MAX_BYTES
} from './message-search'

export type { MessagePredicate } from './filtered-view'
export { SEARCH_MAX_BYTES, searchCacheFormats } from './message-search'

export interface MessagePredicateContext {
  /** Subscriptions of the connection, used to resolve `filter.subscriptionId`. */
  subscriptions?: readonly Pick<Subscription, 'id' | 'topic' | 'subscriptionIdentifier'>[]
  /** View format the text search matches payloads in (as the list shows them). Default `auto`. */
  viewFormat?: ViewFormat
}

/** True when the filter restricts anything (an unknown subscription id still counts). */
export function isMessageFilterActive(filter: MessageFilter): boolean {
  return (
    filter.direction !== 'all' ||
    filter.retainedOnly ||
    filter.topic.trim().length > 0 ||
    filter.search.trim().length > 0 ||
    filter.subscriptionId !== null
  )
}

/**
 * Builds a predicate for `filter`. Checks run cheapest first:
 * - direction and `retainedOnly`
 * - topic: MQTT filter semantics (`topicMatches`) when it contains a valid `+` / `#` filter,
 *   otherwise a case-insensitive substring of the topic
 * - subscription (ignored when the id is unknown): a message delivered with MQTT 5 subscription
 *   identifiers matches when they include the subscription's identifier; otherwise (no
 *   identifiers on either side) its topic must match the subscription's filter
 * - search: case-insensitive substring of the topic or of the payload as `ctx.viewFormat` shows
 *   it (see `createSearchPredicate`; hex bytes for binary data)
 *
 * A filter without a search term also drops the decoded texts cached by an earlier search.
 */
export function createMessagePredicate(
  filter: MessageFilter,
  ctx: MessagePredicateContext = {}
): MessagePredicate {
  const checks: MessagePredicate[] = []

  if (filter.direction !== 'all') {
    const direction = filter.direction
    checks.push((message) => message.direction === direction)
  }
  if (filter.retainedOnly) checks.push((message) => message.retain)

  const topic = filter.topic.trim()
  if (topic) checks.push(topicPredicate(topic))

  if (filter.subscriptionId !== null) {
    const subscription = ctx.subscriptions?.find((sub) => sub.id === filter.subscriptionId)
    if (subscription) checks.push(subscriptionPredicate(subscription))
  }

  const term = normalizeSearchTerm(filter.search)
  if (term) checks.push(createSearchPredicate(term, ctx.viewFormat ?? 'auto'))
  else clearSearchCache()

  if (checks.length === 0) return () => true
  if (checks.length === 1) return checks[0]
  return (message) => {
    for (const check of checks) if (!check(message)) return false
    return true
  }
}

/**
 * Lower-cased `topic + NUL + decoded payload text` in a view format: the reference meaning of
 * the text search for decoded views. It decodes on every call (slow; tests and diagnostics
 * only): the list search uses `createSearchPredicate`, which scans bytes.
 */
export function searchableText(message: MqttMessage, format: ViewFormat): string {
  const payload = decodePayload(message.payload, format, {
    pretty: false,
    maxBytes: SEARCH_MAX_BYTES
  }).text
  return `${message.topic}\u0000${payload}`.toLowerCase()
}

/**
 * Messages delivered for a subscription. With overlapping filters a broker sends one copy per
 * subscription (each with its own identifier) or one copy with every identifier: the
 * identifiers decide when both sides have them, the topic filter otherwise.
 */
export function subscriptionPredicate(
  subscription: Pick<Subscription, 'topic' | 'subscriptionIdentifier'>
): MessagePredicate {
  const filter = subscription.topic
  const identifier = subscription.subscriptionIdentifier
  if (typeof identifier !== 'number' || !Number.isInteger(identifier) || identifier <= 0) {
    return (message) => topicMatches(filter, message.topic)
  }
  return (message) => {
    const ids = message.properties?.subscriptionIdentifier
    return ids && ids.length > 0 ? ids.includes(identifier) : topicMatches(filter, message.topic)
  }
}

function topicPredicate(topic: string): MessagePredicate {
  if (hasWildcard(topic) && validateTopicFilter(topic) === null) {
    return (message) => topicMatches(topic, message.topic)
  }
  const needle = topic.toLowerCase()
  return (message) => lowerTopic(message.topic).includes(needle)
}
