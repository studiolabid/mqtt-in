/**
 * Renderer-only view models shared between stores, composables and features.
 * Domain models live in `@shared/models`.
 */
import type {
  BrokerInfo,
  ConnectionProfile,
  ConnectionStatus,
  MqttMessage,
  PayloadFormat,
  PublishProperties,
  QoS,
  Subscription
} from '@shared/models'

export type WorkspaceTab = 'messages' | 'topics' | 'logs'

export type DirectionFilter = 'all' | 'in' | 'out'

export interface MessageFilter {
  direction: DirectionFilter
  /** Topic filter (wildcards allowed). Empty = every topic. */
  topic: string
  /** Case-insensitive substring matched against topic and decoded payload text. */
  search: string
  /** Only messages matching this subscription's filter. */
  subscriptionId: string | null
  /** Only retained messages. */
  retainedOnly: boolean
}

export const DEFAULT_MESSAGE_FILTER: MessageFilter = {
  direction: 'all',
  topic: '',
  search: '',
  subscriptionId: null,
  retainedOnly: false
}

export interface ConnectionStats {
  received: number
  sent: number
  bytesIn: number
  bytesOut: number
  /** Messages per second, averaged over the last few seconds. */
  inRate: number
  outRate: number
  /**
   * Messages evicted from the ring buffer: over `maxMessagesPerConnection`, or over the byte
   * budget (`MAX_RETAINED_BYTES`).
   */
  dropped: number
  /** Payload bytes currently held in the connection's ring buffer (CT-23). */
  retainedBytes: number
}

export const EMPTY_STATS: ConnectionStats = {
  received: 0,
  sent: 0,
  bytesIn: 0,
  bytesOut: 0,
  inRate: 0,
  outRate: 0,
  dropped: 0,
  retainedBytes: 0
}

export interface SessionView {
  connectionId: string
  status: ConnectionStatus
  error?: string
  clientId?: string
  connectedAt?: number
  /** The broker's CONNACK facts; only while connected (CT-16). */
  broker?: BrokerInfo
  /** Last measured round trip in ms; only while connected (CT-16). */
  rttMs?: number
  /** Epoch ms of the last status change. */
  updatedAt: number
}

export interface PublishDraft {
  topic: string
  /** Authored text (encoded with `format` on publish). */
  payload: string
  format: PayloadFormat
  qos: QoS
  retain: boolean
  /** MQTT 5 only. */
  properties: PublishProperties
  /** Render `{{template}}` tokens before encoding. */
  useTemplate: boolean
}

export interface PublishHistoryItem extends PublishDraft {
  id: string
  timestamp: number
}

export interface ConfirmOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

/** Connection dialog state (create or edit). */
export interface ConnectionDialogState {
  open: boolean
  /** `null` = create a new profile. */
  editingId: string | null
  /** Initial values for a new profile (e.g. a public broker preset). */
  preset: Partial<ConnectionProfile> | null
}

/** Subscription dialog state (create or edit). */
export interface SubscriptionDialogState {
  open: boolean
  connectionId: string | null
  /** `null` = create. */
  editingId: string | null
  preset: Partial<Subscription> | null
  /** Create mode: one filter per line ("Add multiple"). */
  multiple: boolean
}

/** A point series for `TimeSeriesChart`. Points are `[epochMs, value]`, ascending. */
export interface ChartSeries {
  name: string
  color: string
  points: Array<[number, number]>
}

/** A message plus derived, cached display data (see `useMessageList`). */
export interface MessageRowModel {
  message: MqttMessage
  /** One-line payload preview. */
  preview: string
  /** Color of the first matching subscription (or undefined). */
  color?: string
}

// ---------------------------------------------------------------------------
// Added by the renderer core layer (stores / composables)
// ---------------------------------------------------------------------------

/** Repeat-publishing parameters chosen in the publish panel. */
export interface RepeatSettings {
  /** Milliseconds between messages (clamped to `LIMITS.repeatIntervalMs`). */
  intervalMs: number
  /** Number of messages to send; 0 = until stopped. */
  count: number
}

/** File formats of a message export. */
export type MessageExportFormat = 'json' | 'csv'

/** A request to export the messages of a connection (see `useUiStore().requestMessageExport`). */
export interface MessageExportRequest {
  /** Bumps with every request (watch it). */
  seq: number
  format: MessageExportFormat
}

/** A named sidebar group of connection profiles (`name` is `''` for ungrouped profiles). */
export interface ConnectionGroup {
  name: string
  profiles: ConnectionProfile[]
}
