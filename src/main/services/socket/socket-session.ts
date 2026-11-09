/**
 * A live WebSocket or Socket.IO connection, with the same use cases and events as an MQTT
 * session: status (connecting → connected ⇄ reconnecting → disconnecting → disconnected, `error`
 * when it ends because of a failure), logs, `in` / `out` messages and repeat jobs.
 *
 * Every attempt opens a new transport (`OpenTransport`). A dropped connection or a failed
 * attempt is retried with exponential backoff while auto reconnect is on, unless the transport
 * says retrying cannot help (fatal). TLS files are read once, before the first attempt.
 * Subscriptions do not exist here: WebSocket servers send what they send, and a Socket.IO
 * connection receives every event.
 */
import { connectionKind, KIND_LABELS } from '@shared/connection-kind'
import type {
  ConnectionProfile,
  ConnectionStatus,
  MqttMessage,
  PublishRequest,
  RepeatPublishOptions,
  SessionSnapshot,
  SubscriptionEvent
} from '@shared/models'
import { toOwnedBytes } from '../../utils/bytes'
import { errorMessage } from '../../utils/errors'
import type { LiveSession } from '../live-session'
import { reconnectPeriodOf } from '../mqtt/client-options'
import { nextMessageId } from '../mqtt/ids'
import { ReconnectBackoff } from '../mqtt/reconnect-backoff'
import { SessionJobs } from '../mqtt/session-jobs'
import { createSessionLog, type SessionLog } from '../mqtt/session-log'
import { SessionStatus } from '../mqtt/session-status'
import { hasTlsFiles, loadTlsMaterial, type TlsMaterial } from '../mqtt/tls-material'
import type { ReadFileFn, SessionEventSink } from '../mqtt/types'
import { socketIoUrl, websocketUrl } from './socket-options'
import { openSocketIo } from './socketio-transport'
import type { OpenTransport, SocketTransport } from './types'
import { openWebSocket } from './websocket-transport'

export interface SocketSessionOptions {
  /** Profile snapshot (copied; later edits do not affect the live session). */
  profile: ConnectionProfile
  sink: SessionEventSink
  pushMessage: (message: MqttMessage) => void
  /** Default: `openWebSocket` / `openSocketIo` by the profile's kind. */
  open?: OpenTransport
  readFile?: ReadFileFn
  onConnected?: (connectedAt: number) => void
}

const NO_SUBSCRIPTIONS = 'Subscriptions are only for MQTT connections'

function message(
  connectionId: string,
  direction: MqttMessage['direction'],
  topic: string,
  payload: Uint8Array
): MqttMessage {
  return {
    id: nextMessageId(),
    connectionId,
    direction,
    topic,
    payload,
    qos: 0,
    retain: false,
    dup: false,
    timestamp: Date.now()
  }
}

export class SocketSession implements LiveSession {
  readonly connectionId: string
  private readonly profile: ConnectionProfile
  private readonly status: SessionStatus
  private readonly log: SessionLog
  private readonly jobs: SessionJobs
  private readonly open: OpenTransport
  private readonly backoff: ReconnectBackoff | null
  private transport: SocketTransport | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private tls: TlsMaterial = {}
  private connected = false
  private started = false
  private closing = false
  private finished = false
  private attempts = 0

  constructor(private readonly options: SocketSessionOptions) {
    const profile = structuredClone(options.profile)
    this.profile = profile
    this.connectionId = profile.id
    this.log = createSessionLog(profile.id, (entry) => options.sink.log(entry))
    this.status = new SessionStatus(profile.id, (event) => options.sink.status(event))
    const kind = connectionKind(profile)
    this.open = options.open ?? (kind === 'socketio' ? openSocketIo : openWebSocket)
    const period = reconnectPeriodOf(profile)
    this.backoff = period > 0 ? new ReconnectBackoff(period) : null
    this.jobs = new SessionJobs({
      connectionId: profile.id,
      publish: (request) => this.publish(request),
      emit: (event) => options.sink.repeat(event),
      log: this.log,
      check: () => {
        if (!this.connected) throw new Error('Not connected')
      },
      receiveMaximum: () => 65_535
    })
  }

  get state(): ConnectionStatus {
    return this.status.state
  }

  get isConnected(): boolean {
    return this.connected
  }

  get isFinished(): boolean {
    return this.finished
  }

  private get label(): string {
    return KIND_LABELS[connectionKind(this.profile)]
  }

  private url(): string {
    try {
      return connectionKind(this.profile) === 'socketio'
        ? socketIoUrl(this.profile)
        : websocketUrl(this.profile)
    } catch {
      return `${this.profile.protocol}://${this.profile.host}:${this.profile.port}`
    }
  }

  async connect(): Promise<void> {
    if (this.started) return
    this.started = true
    this.status.set('connecting')
    this.log('info', `Connecting to ${this.url()} (${this.label})…`)
    if (this.profile.protocol === 'wss' && hasTlsFiles(this.profile.tls)) {
      try {
        this.tls = await loadTlsMaterial(this.profile.tls, { readFile: this.options.readFile })
      } catch (err) {
        this.end('error', errorMessage(err))
        return
      }
      if (this.closing) return
    }
    this.attempt()
  }

  async disconnect(): Promise<void> {
    if (this.finished) return
    this.closing = true
    this.jobs.stopAll()
    this.clearRetry()
    this.status.set('disconnecting')
    this.transport?.close()
    this.transport = null
    if (this.connected) this.log('info', 'Disconnected')
    this.end('disconnected')
  }

  async subscribe(): Promise<SubscriptionEvent> {
    throw new Error(NO_SUBSCRIPTIONS)
  }

  async unsubscribe(): Promise<SubscriptionEvent> {
    throw new Error(NO_SUBSCRIPTIONS)
  }

  async publish(request: PublishRequest): Promise<void> {
    const transport = this.transport
    if (!transport || !this.connected) throw new Error('Not connected')
    const payload = toOwnedBytes(request.payload)
    try {
      await transport.send(request.topic, payload)
    } catch (err) {
      const reason = errorMessage(err)
      this.log('error', `Could not send to ${request.topic}: ${reason}`)
      throw new Error(reason, { cause: err })
    }
    this.options.pushMessage(message(this.connectionId, 'out', request.topic, payload))
  }

  startRepeat(options: RepeatPublishOptions): string {
    if (!this.connected) throw new Error('Not connected')
    return this.jobs.start(options)
  }

  stopRepeat(jobId: string): boolean {
    return this.jobs.stop(jobId)
  }

  snapshot(): SessionSnapshot {
    return {
      connectionId: this.connectionId,
      ...this.status.snapshot(),
      subscriptions: [],
      repeatJobs: this.jobs.snapshot()
    }
  }

  private attempt(): void {
    if (this.closing || this.finished) return
    const transport = this.open(this.profile, this.tls, {
      onOpen: (id) => {
        if (this.transport !== transport) return
        this.onOpen(id)
      },
      onMessage: (topic, payload) => {
        if (this.transport !== transport) return
        this.options.pushMessage(message(this.connectionId, 'in', topic, payload))
      },
      onClose: (error, fatal) => {
        if (this.transport !== transport) return
        this.transport = null
        this.onClose(error, fatal)
      },
      onRtt: (ms) => {
        if (this.transport === transport) this.status.rtt(ms)
      }
    })
    this.transport = transport
  }

  private onOpen(id: string | undefined): void {
    const at = Date.now()
    this.connected = true
    this.attempts = 0
    this.backoff?.reset()
    if (id) this.status.clientId = id
    this.status.connectedAt = at
    this.status.set('connected')
    this.log('info', id ? `Connected (socket id ${id})` : 'Connected')
    this.jobs.resumeAll()
    this.options.onConnected?.(at)
  }

  private onClose(error: string, fatal: boolean): void {
    const wasConnected = this.connected
    this.connected = false
    this.status.clearConnection()
    if (this.closing) return
    if (fatal || !this.backoff) {
      this.log('error', wasConnected ? error : `Connection failed: ${error}`)
      this.end('error', error)
      return
    }
    this.jobs.pauseAll()
    this.attempts += 1
    const wait = this.backoff.next()
    this.log(
      'warn',
      `${error} — reconnecting in ${Math.round(wait / 100) / 10} s (attempt ${this.attempts})`
    )
    this.status.set('reconnecting', error)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.attempt()
    }, wait)
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private end(state: 'disconnected' | 'error', error?: string): void {
    this.clearRetry()
    this.jobs.stopAll()
    this.connected = false
    this.finished = true
    this.status.clearConnection()
    this.status.set(state, error)
  }
}
