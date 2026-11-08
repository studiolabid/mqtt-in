/**
 * Messages (incoming and outgoing), publish requests, repeat-publish jobs and payload formats.
 */
import type { QoS, UserProperty } from './connection'

/** Encodings a payload can be authored in / decoded as. */
export type PayloadFormat = 'text' | 'json' | 'hex' | 'base64' | 'msgpack' | 'cbor'

/** View format for incoming payloads; `auto` detects JSON / text / binary. */
export type ViewFormat = 'auto' | PayloadFormat

export type MessageDirection = 'in' | 'out'

/** MQTT 5 PUBLISH properties (incoming or outgoing). */
export interface MessageProperties {
  payloadFormatIndicator?: boolean
  messageExpiryInterval?: number
  topicAlias?: number
  responseTopic?: string
  /** UTF-8 decoded correlation data. */
  correlationData?: string
  contentType?: string
  /** Incoming only. */
  subscriptionIdentifier?: number[]
  userProperties?: UserProperty[]
}

export type PublishProperties = Omit<MessageProperties, 'subscriptionIdentifier'>

export interface MqttMessage {
  /** Monotonic id, unique for the lifetime of the main process. */
  id: number
  connectionId: string
  direction: MessageDirection
  topic: string
  payload: Uint8Array
  qos: QoS
  retain: boolean
  dup: boolean
  /** Epoch ms. */
  timestamp: number
  properties?: MessageProperties
}

export interface PublishRequest {
  topic: string
  /** Already-encoded bytes (see `encodePayload` in `@shared/payload`). */
  payload: Uint8Array
  qos: QoS
  retain: boolean
  properties?: PublishProperties
}

export interface RepeatPublishOptions {
  topic: string
  /** Source text; template variables (see `@shared/template`) are rendered on every tick. */
  payload: string
  /** How the (rendered) text is encoded into bytes. */
  format: PayloadFormat
  /**
   * Render template variables (default `true`). `false` sends `payload` exactly as authored,
   * e.g. text that contains literal `{{…}}` (the publish draft's `useTemplate`).
   */
  useTemplate?: boolean
  qos: QoS
  retain: boolean
  properties?: PublishProperties
  /** Interval between messages, >= 10 ms. */
  intervalMs: number
  /** Number of messages to send; 0 = until stopped. */
  count: number
}

export type RepeatJobState = 'running' | 'completed' | 'stopped' | 'error'

export interface RepeatJobEvent {
  jobId: string
  connectionId: string
  topic: string
  state: RepeatJobState
  sent: number
  /** 0 = unlimited. */
  total: number
  intervalMs: number
  error?: string
  timestamp: number
}
