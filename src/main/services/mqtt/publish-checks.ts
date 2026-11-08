/**
 * Local checks before a PUBLISH is handed to mqtt.js. A publish the broker would answer with a
 * DISCONNECT (or that mqtt-packet cannot encode) is refused with a human error instead:
 * - every MQTT string of the request fits (65,535 UTF-8 bytes, no unpaired surrogate);
 * - MQTT 5: what the broker announced in its CONNACK (retain, Maximum QoS, Topic Alias Maximum);
 * - the encoded packet fits Maximum Packet Size (or the protocol maximum).
 */
import type { IConnackPacket } from 'mqtt'
import type { MqttProtocolVersion, PublishRequest } from '@shared/models'
import { utf8ByteLength } from '@shared/mqtt-string'
import { assertMqttBinary, assertMqttString, assertUserProperties } from './mqtt-strings'
import type { PublishPacketProperties } from './properties'

/** The CONNACK properties of an MQTT 5 broker (`{}` when it announced none). */
export type BrokerLimits = NonNullable<IConnackPacket['properties']>

/** Largest MQTT packet: a 4-byte remaining length of at most 268,435,455 (MQTT 5 §1.5.5). */
export const MQTT_MAX_PACKET_BYTES = 1 + 4 + 268_435_455

/**
 * Throws the human reason `request` cannot be sent, or returns. `properties` are the PUBLISH
 * properties mqtt.js gets (MQTT 5 only); `limits` the broker's CONNACK properties while
 * connected (`undefined` otherwise; they only count for MQTT 5, 3.x brokers announce none).
 */
export function assertPublishable(
  request: PublishRequest,
  properties: PublishPacketProperties | undefined,
  limits: BrokerLimits | undefined,
  protocolVersion: MqttProtocolVersion
): void {
  assertMqttString(request.topic, 'Topic')
  if (protocolVersion === 5) {
    const props = request.properties
    assertMqttString(props?.contentType, 'Content type')
    assertMqttString(props?.responseTopic, 'Response topic')
    assertMqttBinary(props?.correlationData, 'Correlation data')
    assertUserProperties(props?.userProperties)
    if (limits) assertBrokerSupports(request, properties, limits)
  }
  const max =
    (protocolVersion === 5 ? limits?.maximumPacketSize : undefined) ?? MQTT_MAX_PACKET_BYTES
  const size = publishPacketSize(request, properties, protocolVersion)
  if (size > max) throw new Error(tooLargeMessage(size, max))
}

/** What an MQTT 5 broker announced it supports. */
function assertBrokerSupports(
  request: PublishRequest,
  properties: PublishPacketProperties | undefined,
  limits: BrokerLimits
): void {
  if (request.retain && limits.retainAvailable === false) {
    throw new Error('The broker does not support retained messages')
  }
  if (limits.maximumQoS !== undefined && request.qos > limits.maximumQoS) {
    throw new Error(`The broker supports QoS ${limits.maximumQoS === 0 ? '0' : '0 and 1'} only`)
  }
  const alias = properties?.topicAlias
  if (alias !== undefined) {
    // Not announced = 0: the broker accepts no topic alias at all (MQTT 5 §3.2.2.3.8).
    const max = limits.topicAliasMaximum ?? 0
    if (max === 0) throw new Error('The broker does not support topic aliases')
    if (alias > max) {
      throw new Error(
        max === 1
          ? 'The broker accepts topic alias 1 only'
          : `The broker accepts topic aliases 1–${max}`
      )
    }
  }
}

/** Size of `n` as a variable byte integer (MQTT 5 §1.5.5). */
function varintSize(n: number): number {
  return n < 128 ? 1 : n < 16_384 ? 2 : n < 2_097_152 ? 3 : 4
}

/** Bytes of the MQTT 5 PUBLISH properties mqtt-packet writes (without their length prefix). */
function propertiesLength(props: PublishPacketProperties | undefined): number {
  if (!props) return 0
  let length = 0
  if (props.payloadFormatIndicator !== undefined) length += 1 + 1
  if (props.messageExpiryInterval !== undefined) length += 1 + 4
  if (props.topicAlias !== undefined) length += 1 + 2
  if (props.contentType !== undefined) length += 1 + 2 + utf8ByteLength(props.contentType)
  if (props.responseTopic !== undefined) length += 1 + 2 + utf8ByteLength(props.responseTopic)
  if (props.correlationData !== undefined) length += 1 + 2 + props.correlationData.byteLength
  const users = props.userProperties ?? {}
  for (const key of Object.keys(users)) {
    const value = users[key]
    for (const item of Array.isArray(value) ? value : [value]) {
      length += 1 + 2 + utf8ByteLength(key) + 2 + utf8ByteLength(String(item))
    }
  }
  return length
}

/** Bytes on the wire of the PUBLISH mqtt.js writes for `request` (fixed header included). */
export function publishPacketSize(
  request: PublishRequest,
  properties: PublishPacketProperties | undefined,
  protocolVersion: MqttProtocolVersion
): number {
  let remaining = 2 + utf8ByteLength(request.topic) + request.payload.byteLength
  if (request.qos > 0) remaining += 2 // packet identifier
  if (protocolVersion === 5) {
    const length = propertiesLength(properties)
    remaining += varintSize(length) + length
  }
  return 1 + varintSize(remaining) + remaining
}

/**
 * `Message is 3.9 KB; the broker accepts at most 1 KB per packet`. Exact byte counts when both
 * would round to the same text (`1 MB` and `1 MB`), so the user sees how much to cut.
 */
function tooLargeMessage(size: number, max: number): string {
  let [a, b] = [formatSize(size), formatSize(max)]
  if (a === b) [a, b] = [bytes(size), bytes(max)]
  return max === MQTT_MAX_PACKET_BYTES
    ? `Message is ${a}; MQTT allows at most ${b} per packet`
    : `Message is ${a}; the broker accepts at most ${b} per packet`
}

/** `512 bytes`, `3.9 KB`, `1 MB`, `1.5 MB` (one decimal, none when it rounds to a whole number). */
function formatSize(n: number): string {
  if (n < 1024) return bytes(n)
  const [value, unit] = n < 1024 * 1024 ? [n / 1024, 'KB'] : [n / (1024 * 1024), 'MB']
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${unit}`
}

function bytes(n: number): string {
  return `${n.toLocaleString('en-US')} bytes`
}
