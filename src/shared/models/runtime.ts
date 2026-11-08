/**
 * Runtime state of live sessions (main → renderer events and snapshots).
 */
import type { MqttProtocolVersion, QoS } from './connection'
import type { RepeatJobEvent } from './message'

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'disconnecting' | 'error'

/**
 * What the broker announced in its last CONNACK. The MQTT 5 capability fields are `undefined`
 * when the broker did not send the property (its default applies) and always on MQTT 3.x.
 */
export interface BrokerInfo {
  protocolVersion: MqttProtocolVersion
  sessionPresent: boolean
  /** Client id assigned by the broker (MQTT 5, when the client sent an empty one). */
  assignedClientId?: string
  /** MQTT 5 CONNACK properties; undefined = not announced (or MQTT 3.x). */
  maximumQoS?: QoS
  retainAvailable?: boolean
  wildcardSubscriptionAvailable?: boolean
  sharedSubscriptionAvailable?: boolean
  subscriptionIdentifiersAvailable?: boolean
  receiveMaximum?: number
  maximumPacketSize?: number
  topicAliasMaximum?: number
  /** Seconds; replaces the keep alive the client asked for. */
  serverKeepAlive?: number
  serverReference?: string
  responseInformation?: string
}

export interface StatusEvent {
  connectionId: string
  status: ConnectionStatus
  /** Human readable error for `error` (and the last error while `reconnecting`). */
  error?: string
  /** Effective client id used for the current/last attempt. */
  clientId?: string
  /** Epoch ms of the CONNACK, set while connected. */
  connectedAt?: number
  /** From the CONNACK, set while connected. */
  sessionPresent?: boolean
  /** The broker's CONNACK facts; on `connected` events only. */
  broker?: BrokerInfo
  /**
   * Last measured round trip in ms (PINGREQ → PINGRESP, QoS 1 PUBLISH → PUBACK), while
   * connected. Sent at most every 5 s and only when it changed noticeably.
   */
  rttMs?: number
  timestamp: number
}

export type SubscriptionState = 'idle' | 'pending' | 'subscribed' | 'failed'

export interface SubscriptionEvent {
  connectionId: string
  subscriptionId: string
  topic: string
  /** `idle` = not subscribed (never, unsubscribed or connection lost). */
  state: SubscriptionState
  grantedQos?: number
  error?: string
  timestamp: number
}

/** The outcome of `mqtt.test()`: one CONNECT with the dialog's settings, then a clean DISCONNECT. */
export interface ConnectionTestResult {
  ok: boolean
  /** `Connected`, or why it failed (e.g. `Connection refused: not authorized`). */
  message: string
  /** The client id the test used (a generated one when the profile's could disturb a session). */
  clientId: string
  durationMs: number
}

export interface SessionSnapshot {
  connectionId: string
  status: ConnectionStatus
  error?: string
  clientId?: string
  connectedAt?: number
  /** The broker's CONNACK facts, while connected. */
  broker?: BrokerInfo
  /** Last measured round trip in ms, while connected. */
  rttMs?: number
  subscriptions: SubscriptionEvent[]
  repeatJobs: RepeatJobEvent[]
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  /** Monotonic id, unique for the lifetime of the main process. */
  id: number
  connectionId: string
  level: LogLevel
  message: string
  detail?: string
  timestamp: number
}
