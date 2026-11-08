/**
 * MQTT topic helpers (spec: MQTT 5.0 §4.7). Pure, dependency free.
 *
 * Topic names and filters are MQTT UTF-8 strings (CT-06): at most 65,535 bytes of well-formed
 * UTF-8, so an unpaired surrogate is refused too (`TextEncoder` and `Buffer` would silently send
 * U+FFFD instead, i.e. another topic than the one shown).
 */
import { LIMITS } from './defaults'
import { hasUnpairedSurrogate, utf8ByteLength } from './mqtt-string'

export function splitTopic(topic: string): string[] {
  return topic.split('/')
}

/**
 * Removes shared-subscription prefixes so the filter can be matched against
 * topic names: `$share/<group>/a/b` → `a/b`, `$queue/a/b` → `a/b` (EMQX).
 */
export function stripSharePrefix(filter: string): string {
  if (filter.startsWith('$share/')) {
    const rest = filter.slice('$share/'.length)
    const slash = rest.indexOf('/')
    return slash === -1 ? '' : rest.slice(slash + 1)
  }
  if (filter.startsWith('$queue/')) return filter.slice('$queue/'.length)
  return filter
}

export function isSharedSubscription(filter: string): boolean {
  return filter.startsWith('$share/') || filter.startsWith('$queue/')
}

export function hasWildcard(filter: string): boolean {
  return filter.includes('+') || filter.includes('#')
}

/** True when `value` is over `LIMITS.maxTopicBytes` in UTF-8 (each UTF-16 unit takes ≥ 1 byte). */
function exceedsTopicBytes(value: string): boolean {
  return value.length > LIMITS.maxTopicBytes || utf8ByteLength(value) > LIMITS.maxTopicBytes
}

/** Validates a topic *name* used for publishing. Returns an error message or `null`. */
export function validateTopicName(topic: string): string | null {
  if (topic.length === 0) return 'Topic is required'
  if (topic.includes('+') || topic.includes('#')) {
    return 'Wildcards (+, #) are not allowed when publishing'
  }
  if (topic.includes('\u0000')) return 'Topic must not contain the null character'
  if (exceedsTopicBytes(topic)) return 'Topic is too long (max 65535 bytes)'
  if (hasUnpairedSurrogate(topic)) return 'Topic contains an unpaired surrogate'
  return null
}

/** Validates a topic *filter* used for subscribing. Returns an error message or `null`. */
export function validateTopicFilter(filter: string): string | null {
  if (filter.length === 0) return 'Topic filter is required'
  if (filter.includes('\u0000')) return 'Topic filter must not contain the null character'
  if (exceedsTopicBytes(filter)) return 'Topic filter is too long (max 65535 bytes)'
  if (hasUnpairedSurrogate(filter)) return 'Topic filter contains an unpaired surrogate'

  let effective = filter
  if (filter.startsWith('$share/')) {
    const parts = filter.split('/')
    if (parts.length < 3 || parts[1].length === 0) {
      return 'Shared subscription must be $share/<group>/<filter>'
    }
    if (parts[1].includes('+') || parts[1].includes('#')) {
      return 'Share group name must not contain wildcards'
    }
    effective = parts.slice(2).join('/')
    if (effective.length === 0) return 'Shared subscription filter is empty'
  } else if (filter.startsWith('$queue/')) {
    effective = filter.slice('$queue/'.length)
    if (effective.length === 0) return 'Queue subscription filter is empty'
  }

  const levels = effective.split('/')
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i]
    if (level.includes('#') && (level !== '#' || i !== levels.length - 1)) {
      return "'#' must be the last level and occupy the whole level"
    }
    if (level.includes('+') && level !== '+') {
      return "'+' must occupy a whole topic level"
    }
  }
  return null
}

/**
 * Returns true when `topic` (a topic name) matches `filter` (a topic filter).
 * Follows the spec: wildcards at the first level do not match topics starting with `$`.
 * Shared-subscription prefixes on the filter are ignored.
 */
export function topicMatches(filter: string, topic: string): boolean {
  const f = stripSharePrefix(filter)
  if (f === topic) return true
  if (f.length === 0) return false

  const fl = f.split('/')
  const tl = topic.split('/')

  if (topic.startsWith('$') && (fl[0] === '+' || fl[0] === '#')) return false

  for (let i = 0; i < fl.length; i++) {
    const part = fl[i]
    if (part === '#') return true // matches parent level too ("a/#" matches "a")
    if (i >= tl.length) return false
    if (part !== '+' && part !== tl[i]) return false
  }
  return fl.length === tl.length
}

/**
 * Returns the first subscription, in list order, whose filter matches the topic (or undefined).
 * Disabled subscriptions (`enabled === false`) are skipped; a missing flag counts as enabled.
 */
export function findMatchingSubscription<T extends { topic: string; enabled?: boolean }>(
  subscriptions: readonly T[],
  topic: string
): T | undefined {
  for (const sub of subscriptions) {
    if (sub.enabled !== false && topicMatches(sub.topic, topic)) return sub
  }
  return undefined
}
