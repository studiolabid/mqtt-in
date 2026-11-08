/**
 * MQTT 5 publish property helpers (pure): what is sent, number parsing, and what the
 * Properties popover shows inline — the broker's topic alias range (MQTT-03, from its CONNACK)
 * and fields the broker would refuse because they are too long in UTF-8 bytes (SEC-03).
 */
import type { BrokerInfo, PublishProperties } from '@shared/models'
import { MQTT_STRING_MAX_BYTES, mqttStringProblem, utf8ByteLength } from '@shared/mqtt-string'
import { cleanPublishProperties } from '@/utils/publish'

/** Message expiry interval is a four byte integer (seconds). */
export const MAX_UINT32 = 4_294_967_295
/** Topic alias is a two byte integer (0 is not allowed). */
export const MAX_UINT16 = 65_535

/** Number of properties that would be sent (each user property counts). */
export function countPublishProperties(properties: PublishProperties | undefined): number {
  const clean = cleanPublishProperties(properties)
  if (!clean) return 0
  const { userProperties, ...rest } = clean
  return Object.keys(rest).length + (userProperties?.length ?? 0)
}

/**
 * Parses an optional whole number in `[min, max]`: '' → undefined (unset), anything else
 * invalid → null.
 */
export function parseWholeNumber(
  text: string,
  min: number,
  max: number
): number | undefined | null {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value >= min && value <= max ? value : null
}

/**
 * What the broker said about topic aliases in its CONNACK: 'The broker accepts topic aliases
 * 1–5', or 'The broker does not support topic aliases' (no Topic Alias Maximum = 0). Null while
 * it is not known (not connected). The field stays editable: the main process refuses an alias
 * the broker would not accept.
 */
export function topicAliasHint(broker: BrokerInfo | undefined): string | null {
  if (!broker) return null
  const max = broker.protocolVersion === 5 ? (broker.topicAliasMaximum ?? 0) : 0
  return max > 0
    ? `The broker accepts topic aliases 1–${max}`
    : 'The broker does not support topic aliases'
}

/** Inline problems of the string properties (absent = fine). */
export interface PropertyProblems {
  contentType?: string
  responseTopic?: string
  correlationData?: string
  userProperties?: string
}

function stringProblem(label: string, value: string | undefined): string | undefined {
  if (!value) return undefined
  const problem = mqttStringProblem(value)
  return problem ? `${label} ${problem}` : undefined
}

/**
 * Fields an MQTT 5 broker would refuse: strings over 65,535 UTF-8 bytes or with an unpaired
 * surrogate; correlation data (binary) over 65,535 bytes. User properties report the first
 * problem, with its row number.
 */
export function publishPropertyProblems(
  properties: PublishProperties | undefined
): PropertyProblems {
  const problems: PropertyProblems = {}
  if (!properties) return problems
  const contentType = stringProblem('Content type', properties.contentType)
  if (contentType) problems.contentType = contentType
  const responseTopic = stringProblem('Response topic', properties.responseTopic)
  if (responseTopic) problems.responseTopic = responseTopic
  const correlation = properties.correlationData
  if (correlation && utf8ByteLength(correlation) > MQTT_STRING_MAX_BYTES) {
    problems.correlationData = `Correlation data is too long (max ${MQTT_STRING_MAX_BYTES} bytes)`
  }
  for (const [index, { key, value }] of (properties.userProperties ?? []).entries()) {
    const problem =
      stringProblem(`User property ${index + 1}: the name`, key) ??
      stringProblem(`User property ${index + 1}: the value`, value)
    if (problem) {
      problems.userProperties = problem
      break
    }
  }
  return problems
}
