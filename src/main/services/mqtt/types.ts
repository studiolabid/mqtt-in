/**
 * Contracts between the MQTT services and their host (IPC layer, tests).
 */
import type { IClientOptions, MqttClient } from 'mqtt'
import type {
  ConnectionProfile,
  LogEntry,
  MqttMessage,
  RepeatJobEvent,
  StatusEvent,
  SubscriptionEvent
} from '@shared/models'

/** Receives every event produced by the MQTT services (the IPC layer forwards them to windows). */
export interface EventSink {
  status(event: StatusEvent): void
  /** Batched (~50 ms) incoming and outgoing messages of all sessions, in order. */
  messages(batch: MqttMessage[]): void
  subscription(event: SubscriptionEvent): void
  log(entry: LogEntry): void
  repeat(event: RepeatJobEvent): void
}

/** The events a single session emits directly (messages go through the batcher). */
export type SessionEventSink = Omit<EventSink, 'messages'>

/** `connect` from `mqtt` (injectable for tests). */
export type ConnectFn = (brokerUrl: string, options: IClientOptions) => MqttClient

/** Options of one `ReadFileFn` call. */
export interface ReadFileOptions {
  /** Aborted once the read took too long (the caller stops waiting anyway). */
  signal: AbortSignal
  /** Larger files must be refused (with an `EFBIG` error, or by returning them: they are checked). */
  maxBytes: number
}

/**
 * Reads a TLS file (CA / certificate / key) without blocking the main process; rejects like
 * `fs.promises` (`code` ENOENT, EACCES…). Default: `readTlsFile` in `./tls-material`.
 */
export type ReadFileFn = (path: string, options: ReadFileOptions) => Promise<Buffer>

/** Where sessions get the persisted profile from (the connections repository). */
export interface ProfileSource {
  get(id: string): ConnectionProfile | undefined
}
