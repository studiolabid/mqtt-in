/**
 * Display helpers for subscription rows (pure): live state glyph, tooltip lines, the topic tree
 * prefix of a filter and stable DOM ids.
 */
import type { QoS, Subscription, SubscriptionEvent, SubscriptionState } from '@shared/models'
import { stripSharePrefix } from '@shared/topic'

/** What the row's status glyph shows: the live state, or `disabled` for a disabled idle one. */
export type SubscriptionGlyph = SubscriptionState | 'disabled'

export function subscriptionGlyph(
  enabled: boolean,
  live: SubscriptionEvent | undefined
): SubscriptionGlyph {
  const state = live?.state ?? 'idle'
  return state === 'idle' && !enabled ? 'disabled' : state
}

export function glyphTitle(glyph: SubscriptionGlyph, connected: boolean): string {
  switch (glyph) {
    case 'subscribed':
      return 'Subscribed'
    case 'pending':
      return 'Subscribing…'
    case 'failed':
      return 'Subscription failed'
    case 'disabled':
      return 'Disabled'
    case 'idle':
      return connected ? 'Not subscribed' : 'Waiting for connection'
  }
}

/** QoS granted by the broker while subscribed (undefined otherwise). */
export function grantedQos(live: SubscriptionEvent | undefined): number | undefined {
  return live?.state === 'subscribed' ? live.grantedQos : undefined
}

/** True when the broker granted another QoS than requested. */
export function isDowngraded(qos: QoS, live: SubscriptionEvent | undefined): boolean {
  const granted = grantedQos(live)
  return granted !== undefined && granted !== qos
}

/**
 * Non-default MQTT 5 options as short labels (`No Local`, `Id 7`…). Retain As Published is on
 * by default, so only turning it off is listed.
 */
export function mqtt5Labels(sub: Subscription): string[] {
  const labels: string[] = []
  if (sub.noLocal) labels.push('No Local')
  if (!sub.retainAsPublished) labels.push('Retain As Published off')
  if (sub.retainHandling === 1) labels.push('Retained: new subscriptions only')
  if (sub.retainHandling === 2) labels.push('Retained: never')
  if (sub.subscriptionIdentifier !== undefined) labels.push(`Id ${sub.subscriptionIdentifier}`)
  return labels
}

/** Secondary tooltip lines of the status glyph (error, QoS, MQTT 5 options). */
export function statusDetails(
  sub: Subscription,
  live: SubscriptionEvent | undefined,
  mqtt5: boolean
): string[] {
  const lines: string[] = []
  if (live?.state === 'failed') lines.push(live.error ?? 'Refused by the broker')
  const granted = grantedQos(live)
  if (granted !== undefined && granted !== sub.qos) {
    lines.push(`Granted QoS ${granted} (requested ${sub.qos})`)
  } else {
    lines.push(`QoS ${sub.qos}`)
  }
  if (live?.state === 'subscribed' && live.error) lines.push(live.error)
  if (mqtt5) {
    const options = mqtt5Labels(sub)
    if (options.length > 0) lines.push(options.join(' · '))
  }
  return lines
}

/**
 * Literal levels before the first wildcard, without a shared-subscription prefix: the topic to
 * open in the topic tree (`sensors/+/temp` → `sensors`, `#` → `''`).
 */
export function filterPrefix(filter: string): string {
  const levels = stripSharePrefix(filter).split('/')
  const wildcard = levels.findIndex((level) => level === '+' || level === '#')
  return (wildcard === -1 ? levels : levels.slice(0, wildcard)).join('/')
}

/** DOM id of a subscription row (`aria-activedescendant`, scrolling, keyboard context menu). */
export function subscriptionDomId(subscriptionId: string): string {
  return `subscription-row-${subscriptionId}`
}
