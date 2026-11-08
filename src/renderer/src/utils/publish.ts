/**
 * Publish draft helpers: defaults, validation, request building and payload round-trips
 * (pure, no Vue).
 *
 * MQTT strings are checked in UTF-8 bytes before anything is sent (`@shared/mqtt-string`): an
 * over-long property would otherwise break the packet in the main process.
 */
import type {
  MqttMessage,
  MqttProtocolVersion,
  PayloadFormat,
  PublishProperties,
  PublishRequest,
  QoS,
  UserProperty
} from '@shared/models'
import {
  detectFormat,
  encodePayload,
  formatJson,
  PAYLOAD_FORMATS,
  toHex,
  utf8Decode
} from '@shared/payload'
import { MQTT_STRING_MAX_BYTES, mqttStringProblem, utf8ByteLength } from '@shared/mqtt-string'
import { hasTemplate, renderTemplate } from '@shared/template'
import { hasWildcard, validateTopicName } from '@shared/topic'
import type { PublishDraft, PublishHistoryItem } from '@/types'

export const DEFAULT_PUBLISH_TOPIC = 'mqtey/test'
export const DEFAULT_PUBLISH_PAYLOAD = '{\n  "msg": "hello from mqtey",\n  "at": "{{iso}}"\n}'

/** A fresh draft with the mqtey defaults, overridden by `overrides`. */
export function createPublishDraft(overrides: Partial<PublishDraft> = {}): PublishDraft {
  return {
    topic: DEFAULT_PUBLISH_TOPIC,
    payload: DEFAULT_PUBLISH_PAYLOAD,
    format: 'json',
    qos: 0,
    retain: false,
    useTemplate: true,
    ...overrides,
    properties: {
      ...overrides.properties,
      userProperties: (overrides.properties?.userProperties ?? []).map((p) => ({ ...p }))
    }
  }
}

/**
 * MQTT 5 properties as they should be sent: empty strings, non-finite numbers, user properties
 * without a key and `undefined` values are dropped.
 *
 * @returns `undefined` when nothing is left.
 */
export function cleanPublishProperties(
  properties: PublishProperties | undefined
): PublishProperties | undefined {
  if (!properties) return undefined
  const out: PublishProperties = {}
  if (typeof properties.payloadFormatIndicator === 'boolean') {
    out.payloadFormatIndicator = properties.payloadFormatIndicator
  }
  if (isNonNegativeInteger(properties.messageExpiryInterval)) {
    out.messageExpiryInterval = properties.messageExpiryInterval
  }
  if (isNonNegativeInteger(properties.topicAlias) && properties.topicAlias > 0) {
    out.topicAlias = properties.topicAlias
  }
  if (properties.responseTopic) out.responseTopic = properties.responseTopic
  if (properties.correlationData) out.correlationData = properties.correlationData
  if (properties.contentType) out.contentType = properties.contentType
  const userProperties = (properties.userProperties ?? [])
    .filter((p) => p.key.trim().length > 0)
    .map((p) => ({ key: p.key, value: p.value }))
  if (userProperties.length > 0) out.userProperties = userProperties
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Why MQTT 5 publish properties cannot be sent, or `null`: string properties and user
 * properties must be MQTT strings (at most 65,535 UTF-8 bytes, no unpaired surrogate), the
 * correlation data at most 65,535 bytes, and the response topic must not hold wildcards.
 * E.g. `'Content type is too long (max 65535 bytes)'`.
 */
export function publishPropertiesProblem(properties: PublishProperties | undefined): string | null {
  if (!properties) return null
  const strings: Array<[label: string, value: string | undefined]> = [
    ['Content type', properties.contentType],
    ['Response topic', properties.responseTopic]
  ]
  for (const { key, value } of properties.userProperties ?? []) {
    strings.push(['User property name', key], ['User property value', value])
  }
  for (const [label, value] of strings) {
    const problem = value === undefined ? null : mqttStringProblem(value)
    if (problem) return `${label} ${problem}`
  }
  if (properties.responseTopic && hasWildcard(properties.responseTopic)) {
    return 'Response topic must not contain wildcards (+, #)'
  }
  const correlation = properties.correlationData
  if (correlation !== undefined && utf8ByteLength(correlation) > MQTT_STRING_MAX_BYTES) {
    return `Correlation data is too long (max ${MQTT_STRING_MAX_BYTES} bytes)`
  }
  return null
}

export type PreparedPublish = { ok: true; request: PublishRequest } | { ok: false; error: string }

export interface PreparePublishOptions {
  protocolVersion: MqttProtocolVersion
  /** `{{counter}}` value. Default 1. */
  counter?: number
  /** Fixed "now" for templates (tests). */
  now?: number
}

/**
 * Validates a draft and builds the IPC request: topic validation, template rendering (when
 * enabled and present), payload encoding, MQTT 5 properties (only for protocol version 5,
 * checked with `publishPropertiesProblem`).
 */
export function preparePublish(
  draft: PublishDraft,
  options: PreparePublishOptions
): PreparedPublish {
  const topicError = validateTopicName(draft.topic)
  if (topicError) return { ok: false, error: topicError }

  const text =
    draft.useTemplate && hasTemplate(draft.payload)
      ? renderTemplate(draft.payload, { counter: options.counter ?? 1, now: options.now })
      : draft.payload
  let payload: Uint8Array
  try {
    payload = encodePayload(text, draft.format)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const request: PublishRequest = {
    topic: draft.topic,
    payload,
    qos: draft.qos,
    retain: draft.retain
  }
  const properties =
    options.protocolVersion === 5 ? cleanPublishProperties(draft.properties) : undefined
  const problem = publishPropertiesProblem(properties)
  if (problem) return { ok: false, error: problem }
  if (properties) request.properties = properties
  return { ok: true, request }
}

/**
 * Editable representation of received bytes: printable JSON → pretty JSON, printable text →
 * text, anything else → hex (16 bytes per line).
 */
export function payloadForEditing(bytes: Uint8Array): { payload: string; format: PayloadFormat } {
  const detected = detectFormat(bytes)
  if (detected === 'hex') return { payload: toHex(bytes, ' ', 16), format: 'hex' }
  const text = utf8Decode(bytes)
  if (detected === 'json') {
    try {
      return { payload: formatJson(text), format: 'json' }
    } catch {
      return { payload: text, format: 'text' }
    }
  }
  return { payload: text, format: 'text' }
}

/**
 * Draft that re-publishes `message`: topic, QoS, retain, properties (without the
 * receive-only subscription identifier and the connection-scoped topic alias) and payload.
 * Template rendering is turned off when the payload itself contains template tokens.
 */
export function draftFromMessage(message: MqttMessage, current: PublishDraft): PublishDraft {
  const { payload, format } = payloadForEditing(message.payload)
  const source = message.properties ?? {}
  const properties: PublishProperties = {
    userProperties: copyUserProperties(source.userProperties)
  }
  if (source.payloadFormatIndicator !== undefined) {
    properties.payloadFormatIndicator = source.payloadFormatIndicator
  }
  if (source.messageExpiryInterval !== undefined) {
    properties.messageExpiryInterval = source.messageExpiryInterval
  }
  if (source.responseTopic !== undefined) properties.responseTopic = source.responseTopic
  if (source.correlationData !== undefined) properties.correlationData = source.correlationData
  if (source.contentType !== undefined) properties.contentType = source.contentType
  return {
    topic: message.topic,
    payload,
    format,
    qos: message.qos,
    retain: message.retain,
    properties,
    useTemplate: hasTemplate(payload) ? false : current.useTemplate
  }
}

/** True when two drafts would publish the same thing (ids and timestamps ignored). */
export function sameDraftContent(a: PublishDraft, b: PublishDraft): boolean {
  return (
    a.topic === b.topic &&
    a.payload === b.payload &&
    a.format === b.format &&
    a.qos === b.qos &&
    a.retain === b.retain &&
    a.useTemplate === b.useTemplate &&
    JSON.stringify(cleanPublishProperties(a.properties) ?? {}) ===
      JSON.stringify(cleanPublishProperties(b.properties) ?? {})
  )
}

// ---------------------------------------------------------------------------
// Validation of persisted data (storage contents are untrusted)
// ---------------------------------------------------------------------------

const FORMATS = new Set<string>(PAYLOAD_FORMATS.map((f) => f.value))

/** Parses a persisted draft; missing fields get defaults. `null` when it is not a draft. */
export function parseDraft(value: unknown): PublishDraft | null {
  if (!isRecord(value) || typeof value.topic !== 'string' || typeof value.payload !== 'string') {
    return null
  }
  return {
    topic: value.topic,
    payload: value.payload,
    format:
      typeof value.format === 'string' && FORMATS.has(value.format)
        ? (value.format as PayloadFormat)
        : 'text',
    qos: isQos(value.qos) ? value.qos : 0,
    retain: value.retain === true,
    useTemplate: value.useTemplate !== false,
    properties: parseProperties(value.properties)
  }
}

/** Parses a persisted history item. `null` when invalid. */
export function parseHistoryItem(value: unknown): PublishHistoryItem | null {
  const draft = parseDraft(value)
  if (!draft || !isRecord(value) || typeof value.id !== 'string') return null
  const timestamp =
    typeof value.timestamp === 'number' && Number.isFinite(value.timestamp) ? value.timestamp : 0
  return { ...draft, id: value.id, timestamp }
}

function parseProperties(value: unknown): PublishProperties {
  const out: PublishProperties = { userProperties: [] }
  if (!isRecord(value)) return out
  if (typeof value.payloadFormatIndicator === 'boolean') {
    out.payloadFormatIndicator = value.payloadFormatIndicator
  }
  if (isNonNegativeInteger(value.messageExpiryInterval)) {
    out.messageExpiryInterval = value.messageExpiryInterval
  }
  if (isNonNegativeInteger(value.topicAlias)) out.topicAlias = value.topicAlias
  if (typeof value.responseTopic === 'string') out.responseTopic = value.responseTopic
  if (typeof value.correlationData === 'string') out.correlationData = value.correlationData
  if (typeof value.contentType === 'string') out.contentType = value.contentType
  if (Array.isArray(value.userProperties)) {
    out.userProperties = value.userProperties.filter(
      (p): p is UserProperty =>
        isRecord(p) && typeof p.key === 'string' && typeof p.value === 'string'
    )
    out.userProperties = copyUserProperties(out.userProperties)
  }
  return out
}

function copyUserProperties(list: readonly UserProperty[] | undefined): UserProperty[] {
  return (list ?? []).map((p) => ({ key: p.key, value: p.value }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isQos(value: unknown): value is QoS {
  return value === 0 || value === 1 || value === 2
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}
