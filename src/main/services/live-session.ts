/**
 * What `MqttManager` needs from a live connection, whatever it speaks: an MQTT session
 * (`mqtt/mqtt-session`) or a WebSocket / Socket.IO session (`socket/socket-session`).
 */
import type {
  ConnectionStatus,
  PublishRequest,
  RepeatPublishOptions,
  SessionSnapshot,
  Subscription,
  SubscriptionEvent
} from '@shared/models'

export interface LiveSession {
  readonly connectionId: string
  readonly state: ConnectionStatus
  readonly isConnected: boolean
  /** True once the session ended (`disconnected` / `error`); a session is single-use. */
  readonly isFinished: boolean
  /** Starts the attempt; progress and failures are status events. Never rejects. */
  connect(): Promise<void>
  /** Graceful close, forced after `timeoutMs`. Stops the repeat jobs. */
  disconnect(timeoutMs?: number): Promise<void>
  subscribe(subscription: Subscription): Promise<SubscriptionEvent>
  unsubscribe(subscription: Subscription): Promise<SubscriptionEvent>
  /** Sends a message; it is emitted as an `out` message once handed to the transport. */
  publish(request: PublishRequest): Promise<void>
  /** Starts a repeat job (validated options); returns its id. */
  startRepeat(options: RepeatPublishOptions): string
  /** False when the job is unknown to this session. */
  stopRepeat(jobId: string): boolean
  snapshot(): SessionSnapshot
}
