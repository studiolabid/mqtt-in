/**
 * What a SUBSCRIBE may carry on the current connection: the MQTT 5 subscription options, the
 * broker capabilities its CONNACK announced (wildcard, shared and subscription-identifier
 * support), and the human text of a refused SUBACK / UNSUBACK.
 */
import type { IClientSubscribeOptions, Packet } from 'mqtt'
import type { MqttProtocolVersion, Subscription } from '@shared/models'
import { isSharedSubscription } from '@shared/topic'
import { formatReasonCode, reasonCodeText } from './reason-codes'

/** The CONNACK capability flags (MQTT 5): `false` = not supported, absent = supported. */
export interface SubscribeCapabilities {
  wildcardSubscriptionAvailable?: boolean
  sharedSubscriptionAvailable?: boolean
  subscriptionIdentifiersAvailable?: boolean
}

/**
 * Why the broker would refuse this subscription by disconnecting (MQTT 5 §3.2.2.3: 0xA2 / 0x9E),
 * e.g. `The broker does not support wildcard subscriptions`; null when it can take it.
 */
export function unsupportedSubscription(
  topic: string,
  capabilities: SubscribeCapabilities | undefined
): string | null {
  if (capabilities?.wildcardSubscriptionAvailable === false && /[+#]/.test(topic)) {
    return 'The broker does not support wildcard subscriptions'
  }
  if (capabilities?.sharedSubscriptionAvailable === false && isSharedSubscription(topic)) {
    return 'The broker does not support shared subscriptions'
  }
  return null
}

export interface SubscribeRequest {
  options: IClientSubscribeOptions
  /** The subscription identifier was left out: the broker does not support them. */
  droppedIdentifier: boolean
}

/** mqtt.js subscribe options for `sub` (MQTT 5 options on 5.0 only). */
export function subscribeRequest(
  sub: Subscription,
  protocolVersion: MqttProtocolVersion,
  capabilities: SubscribeCapabilities | undefined
): SubscribeRequest {
  if (protocolVersion !== 5) return { options: { qos: sub.qos }, droppedIdentifier: false }
  const options: IClientSubscribeOptions = {
    qos: sub.qos,
    // No Local on a shared subscription is a protocol error (MQTT 5 §3.8.3.1).
    nl: sub.noLocal && !isSharedSubscription(sub.topic),
    rap: sub.retainAsPublished,
    rh: sub.retainHandling
  }
  if (sub.subscriptionIdentifier === undefined) return { options, droppedIdentifier: false }
  // A broker without support disconnects with 0xA1 for a SUBSCRIBE that carries one.
  if (capabilities?.subscriptionIdentifiersAvailable === false) {
    return { options, droppedIdentifier: true }
  }
  options.properties = { subscriptionIdentifier: sub.subscriptionIdentifier }
  return { options, droppedIdentifier: false }
}

/** First reason code of a SUBACK / UNSUBACK packet. */
export function firstAckCode(packet: Packet | undefined): number | undefined {
  if (!packet || (packet.cmd !== 'suback' && packet.cmd !== 'unsuback')) return undefined
  const first: unknown = Array.isArray(packet.granted) ? packet.granted[0] : undefined
  return typeof first === 'number' ? first : undefined
}

/** Human reason for a refused SUBACK / UNSUBACK code (MQTT 3.x only says "refused"). */
export function ackRefusal(code: number, protocolVersion: MqttProtocolVersion): string {
  return protocolVersion === 5
    ? `${reasonCodeText(code)} (${formatReasonCode(code)})`
    : 'Refused by the broker'
}
