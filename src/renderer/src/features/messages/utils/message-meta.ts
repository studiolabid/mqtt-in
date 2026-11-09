/**
 * Display helpers for one message: payload text, the one-line summary of the detail panel,
 * MQTT 5 properties, format labels (pure).
 */
import type {
  MessageDirection,
  MessageProperties,
  MqttMessage,
  PayloadFormat,
  UserProperty,
  ViewFormat
} from '@shared/models'
import { decodePayload, detectFormat, VIEW_FORMATS } from '@shared/payload'
import { toExportedMessage } from '@/utils/export'
import { formatBytes, formatClock, formatNumber } from '@/utils/format'

export const DIRECTION_LABELS: Readonly<Record<MessageDirection, string>> = {
  in: 'Incoming',
  out: 'Outgoing'
}

const FORMAT_LABELS: Readonly<Record<PayloadFormat, string>> = {
  json: 'JSON',
  text: 'Text',
  hex: 'Binary',
  base64: 'Base64',
  msgpack: 'MessagePack',
  cbor: 'CBOR'
}

/** Narrows a select / menu value to a view format. */
export function isViewFormat(value: unknown): value is ViewFormat {
  return VIEW_FORMATS.some((format) => format.value === value)
}

export function viewFormatLabel(format: ViewFormat): string {
  return VIEW_FORMATS.find((item) => item.value === format)?.label ?? format
}

/** What the payload looks like (`JSON`, `Text` or `Binary`), from auto detection. */
export function detectedFormatLabel(payload: Uint8Array): string {
  if (payload.length === 0) return 'Empty'
  return FORMAT_LABELS[detectFormat(payload)]
}

/**
 * Payload text for the clipboard, decoded with `format`. Compact by default (JSON keeps the
 * bytes as received); `pretty` matches what the payload viewer shows.
 */
export function payloadText(message: MqttMessage, format: ViewFormat, pretty = false): string {
  return decodePayload(message.payload, format, { pretty }).text
}

/** The message as pretty JSON (the export record: topic, flags, payload, base64, properties). */
export function messageAsJson(message: MqttMessage, format: ViewFormat): string {
  return JSON.stringify(toExportedMessage(message, format), null, 2)
}

export type PropertyKind = 'text' | 'mono' | 'topic'

export interface PropertyItem {
  label: string
  value: string
  kind: PropertyKind
}

/** MQTT 5 properties that are present, in a stable display order (user properties excluded). */
export function propertyItems(properties: MessageProperties | undefined): PropertyItem[] {
  if (!properties) return []
  const items: PropertyItem[] = []
  if (properties.contentType) {
    items.push({ label: 'Content type', value: properties.contentType, kind: 'mono' })
  }
  if (typeof properties.payloadFormatIndicator === 'boolean') {
    items.push({
      label: 'Payload format',
      value: properties.payloadFormatIndicator ? 'UTF-8 text' : 'Unspecified bytes',
      kind: 'text'
    })
  }
  if (typeof properties.messageExpiryInterval === 'number') {
    items.push({
      label: 'Message expiry',
      value: formatSeconds(properties.messageExpiryInterval),
      kind: 'mono'
    })
  }
  if (properties.responseTopic) {
    items.push({ label: 'Response topic', value: properties.responseTopic, kind: 'topic' })
  }
  if (properties.correlationData) {
    items.push({ label: 'Correlation data', value: properties.correlationData, kind: 'mono' })
  }
  if (typeof properties.topicAlias === 'number') {
    items.push({ label: 'Topic alias', value: String(properties.topicAlias), kind: 'mono' })
  }
  if (properties.subscriptionIdentifier && properties.subscriptionIdentifier.length > 0) {
    items.push({
      label:
        properties.subscriptionIdentifier.length === 1
          ? 'Subscription identifier'
          : 'Subscription identifiers',
      value: properties.subscriptionIdentifier.join(', '),
      kind: 'mono'
    })
  }
  return items
}

export function userProperties(properties: MessageProperties | undefined): UserProperty[] {
  return properties?.userProperties ?? []
}

/** MQTT 5 properties present on a message (every user property counts). */
export function propertyCount(properties: MessageProperties | undefined): number {
  return propertyItems(properties).length + userProperties(properties).length
}

export type MessageFlagTone = 'info' | 'warning' | 'neutral'

/** A chip of the summary line: only for flags that are set. */
export interface MessageFlag {
  label: string
  tone: MessageFlagTone
  /** Longer explanation (tooltip). */
  title: string
}

export interface MessageSummary {
  /** Time, size, QoS and format in one mono line: `08:35:53.313 · 32 B · QoS 0 · JSON`. */
  line: string
  /** Retained, DUP and the MQTT 5 property count, each only when present. */
  flags: MessageFlag[]
}

/**
 * The summary line under the topic in the message detail (the payload follows right after;
 * everything else is in the collapsed "Details").
 */
export function messageSummary(
  message: MqttMessage,
  options: { qos?: boolean } = {}
): MessageSummary {
  const line = [
    formatClock(message.timestamp, true),
    formatBytes(message.payload.length),
    // WebSocket / Socket.IO messages have no QoS (`qos: false`).
    ...(options.qos === false ? [] : [`QoS ${message.qos}`]),
    detectedFormatLabel(message.payload)
  ].join(' · ')
  const flags: MessageFlag[] = []
  if (message.retain) {
    flags.push({
      label: 'Retained',
      tone: 'info',
      title: 'The message arrived with the retain flag'
    })
  }
  if (message.dup) {
    flags.push({ label: 'DUP', tone: 'warning', title: 'Duplicate delivery (DUP flag)' })
  }
  const count = propertyCount(message.properties)
  if (count > 0) {
    flags.push({
      label: `${count} MQTT 5 ${count === 1 ? 'property' : 'properties'}`,
      tone: 'neutral',
      title: 'Listed under Details'
    })
  }
  return { line, flags }
}

/** `90 s (1m 30s)`; plain `45 s` below a minute. */
export function formatSeconds(total: number): string {
  if (!Number.isFinite(total) || total < 60) return `${total} s`
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts = [
    days > 0 ? `${days}d` : '',
    hours > 0 ? `${hours}h` : '',
    minutes > 0 ? `${minutes}m` : '',
    seconds > 0 ? `${seconds}s` : ''
  ].filter(Boolean)
  return `${formatNumber(total)} s (${parts.join(' ')})`
}
