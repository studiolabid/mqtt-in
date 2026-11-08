/**
 * Conversions between the app's MQTT 5 property models (`@shared/models`) and the
 * packet properties used by mqtt.js. Undefined and empty values are omitted.
 */
import type { IClientOptions, IPublishPacket } from 'mqtt'
import type {
  ConnectProperties,
  MessageProperties,
  PublishProperties,
  UserProperty,
  WillProperties
} from '@shared/models'

/** mqtt.js user properties: duplicate keys are represented as arrays. */
export type PacketUserProperties = Record<string, string | string[]>
export type PublishPacketProperties = NonNullable<IPublishPacket['properties']>
export type ConnectPacketProperties = NonNullable<IClientOptions['properties']>
export type WillPacketProperties = NonNullable<NonNullable<IClientOptions['will']>['properties']>

function isNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasKeys(value: object): boolean {
  return Object.keys(value).length > 0
}

/** `[{ key, value }]` → `{ key: value }` (duplicate keys become arrays; empty keys are skipped). */
export function toPacketUserProperties(
  list: readonly UserProperty[] | undefined
): PacketUserProperties | undefined {
  if (!list || list.length === 0) return undefined
  // Null prototype: keys such as "__proto__" stay ordinary data.
  const record: PacketUserProperties = Object.create(null)
  for (const { key, value } of list) {
    if (key === '') continue
    const existing = record[key]
    if (existing === undefined) record[key] = value
    else if (Array.isArray(existing)) existing.push(value)
    else record[key] = [existing, value]
  }
  return hasKeys(record) ? record : undefined
}

/** `{ key: value | value[] }` → `[{ key, value }]` in key order. */
export function fromPacketUserProperties(
  record: PacketUserProperties | undefined
): UserProperty[] | undefined {
  if (!record) return undefined
  const list: UserProperty[] = []
  for (const key of Object.keys(record)) {
    const value = record[key]
    for (const item of Array.isArray(value) ? value : [value]) {
      list.push({ key, value: String(item) })
    }
  }
  return list.length > 0 ? list : undefined
}

function decodeCorrelationData(value: Buffer | string | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = typeof value === 'string' ? value : Buffer.from(value).toString('utf8')
  return text.length > 0 ? text : undefined
}

/** App publish properties → mqtt.js PUBLISH properties (or `undefined` when nothing is set). */
export function toPublishPacketProperties(
  props: PublishProperties | undefined
): PublishPacketProperties | undefined {
  if (!props) return undefined
  const out: PublishPacketProperties = {}
  if (typeof props.payloadFormatIndicator === 'boolean') {
    out.payloadFormatIndicator = props.payloadFormatIndicator
  }
  if (isNumber(props.messageExpiryInterval)) out.messageExpiryInterval = props.messageExpiryInterval
  if (isNumber(props.topicAlias) && props.topicAlias > 0) out.topicAlias = props.topicAlias
  if (props.responseTopic) out.responseTopic = props.responseTopic
  if (props.correlationData) out.correlationData = Buffer.from(props.correlationData, 'utf8')
  if (props.contentType) out.contentType = props.contentType
  const userProperties = toPacketUserProperties(props.userProperties)
  if (userProperties) out.userProperties = userProperties
  return hasKeys(out) ? out : undefined
}

/** mqtt.js PUBLISH properties → app message properties (or `undefined` when empty). */
export function fromPublishPacketProperties(
  props: PublishPacketProperties | undefined
): MessageProperties | undefined {
  if (!props) return undefined
  const out: MessageProperties = {}
  if (typeof props.payloadFormatIndicator === 'boolean') {
    out.payloadFormatIndicator = props.payloadFormatIndicator
  }
  if (isNumber(props.messageExpiryInterval)) out.messageExpiryInterval = props.messageExpiryInterval
  if (isNumber(props.topicAlias)) out.topicAlias = props.topicAlias
  if (props.responseTopic) out.responseTopic = props.responseTopic
  const correlationData = decodeCorrelationData(props.correlationData)
  if (correlationData !== undefined) out.correlationData = correlationData
  if (props.contentType) out.contentType = props.contentType
  const ids = props.subscriptionIdentifier
  if (ids !== undefined) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => isNumber(id))
    if (list.length > 0) out.subscriptionIdentifier = list
  }
  const userProperties = fromPacketUserProperties(props.userProperties)
  if (userProperties) out.userProperties = userProperties
  return hasKeys(out) ? out : undefined
}

/** MQTT 5 CONNECT properties of a profile (or `undefined` when nothing is set). */
export function toConnectPacketProperties(
  props: ConnectProperties
): ConnectPacketProperties | undefined {
  const out: ConnectPacketProperties = {}
  if (isNumber(props.sessionExpiryInterval)) out.sessionExpiryInterval = props.sessionExpiryInterval
  if (isNumber(props.receiveMaximum)) out.receiveMaximum = props.receiveMaximum
  if (isNumber(props.maximumPacketSize)) out.maximumPacketSize = props.maximumPacketSize
  if (isNumber(props.topicAliasMaximum)) out.topicAliasMaximum = props.topicAliasMaximum
  if (typeof props.requestResponseInformation === 'boolean') {
    out.requestResponseInformation = props.requestResponseInformation
  }
  if (typeof props.requestProblemInformation === 'boolean') {
    out.requestProblemInformation = props.requestProblemInformation
  }
  const userProperties = toPacketUserProperties(props.userProperties)
  if (userProperties) out.userProperties = userProperties
  return hasKeys(out) ? out : undefined
}

/** MQTT 5 Will properties of a profile (or `undefined` when nothing is set). */
export function toWillPacketProperties(props: WillProperties): WillPacketProperties | undefined {
  const out: WillPacketProperties = {}
  if (isNumber(props.willDelayInterval)) out.willDelayInterval = props.willDelayInterval
  if (typeof props.payloadFormatIndicator === 'boolean') {
    out.payloadFormatIndicator = props.payloadFormatIndicator
  }
  if (isNumber(props.messageExpiryInterval)) out.messageExpiryInterval = props.messageExpiryInterval
  if (props.contentType) out.contentType = props.contentType
  if (props.responseTopic) out.responseTopic = props.responseTopic
  if (props.correlationData) out.correlationData = Buffer.from(props.correlationData, 'utf8')
  const userProperties = toPacketUserProperties(props.userProperties)
  if (userProperties) out.userProperties = userProperties
  return hasKeys(out) ? out : undefined
}
