/**
 * One live connection: wraps an mqtt.js client created from a profile snapshot and maps
 * its lifecycle to status / subscription / log events, messages and repeat jobs.
 *
 * The session wires its parts together and offers the use cases; `SessionLink` owns the
 * client and its lifecycle. Status machine: disconnected → connecting → connected ⇄
 * reconnecting → disconnecting → disconnected; `error` when the session ends because of a
 * failure. A TLS profile reads its CA / certificate / key files while `connecting`, before the
 * client exists. A session is single-use.
 *
 * Subscriptions: the profile's enabled subscriptions are restored after every CONNACK; the
 * filters of its disabled ones (and those this app run subscribed before, `subscribedFilters`)
 * are unsubscribed when the broker resumes a persistent session.
 */
import type {
  ConnectionProfile,
  ConnectionStatus,
  MqttMessage,
  PublishRequest,
  RepeatPublishOptions,
  SessionSnapshot,
  Subscription,
  SubscriptionEvent
} from '@shared/models'
import { SessionDiagnostics } from './session-diagnostics'
import { SessionJobs } from './session-jobs'
import { SessionLink } from './session-link'
import { createSessionLog } from './session-log'
import { SessionPublisher } from './session-publisher'
import { SessionStatus } from './session-status'
import { SessionSubscriptions } from './session-subscriptions'
import type { ConnectFn, ReadFileFn, SessionEventSink } from './types'

export const DISCONNECT_TIMEOUT_MS = 2000

export interface MqttSessionOptions {
  /** Profile snapshot (copied; later edits do not affect the live session). */
  profile: ConnectionProfile
  sink: SessionEventSink
  /** Receives every incoming and outgoing message (usually a `MessageBatcher`). */
  pushMessage: (message: MqttMessage) => void
  connect?: ConnectFn
  /** Reads TLS files (default: `readTlsFile`, asynchronous with a size cap). */
  readFile?: ReadFileFn
  /** Called on every successful CONNACK. */
  onConnected?: (connectedAt: number) => void
  /**
   * The filters the broker may hold for this connection, shared by its successive sessions
   * (the manager keeps one set per connection). Default: a set of this session only.
   */
  subscribedFilters?: Set<string>
}

export class MqttSession {
  readonly connectionId: string
  private readonly status: SessionStatus
  private readonly subscriptions: SessionSubscriptions
  private readonly publisher: SessionPublisher
  private readonly jobs: SessionJobs
  private readonly link: SessionLink

  constructor(options: MqttSessionOptions) {
    const { sink } = options
    const profile = structuredClone(options.profile)
    const version = profile.protocolVersion
    const ctx = { host: profile.host.trim(), port: profile.port }
    const base = { connectionId: profile.id, protocolVersion: version }
    const log = createSessionLog(profile.id, (entry) => sink.log(entry))
    this.connectionId = profile.id
    this.status = new SessionStatus(profile.id, (event) => sink.status(event))
    const diagnostics = new SessionDiagnostics(version, ctx, log, profile.protocol)
    this.subscriptions = new SessionSubscriptions({
      ...base,
      emit: (event) => sink.subscription(event),
      log,
      isConnected: () => this.isConnected,
      filters: options.subscribedFilters,
      retired: profile.subscriptions.filter((sub) => !sub.enabled).map((sub) => sub.topic)
    })
    this.publisher = new SessionPublisher({
      ...base,
      ctx,
      log,
      pushMessage: options.pushMessage,
      onWriteFailure: (err) => this.link.onWriteFailure(err)
    })
    this.jobs = new SessionJobs({
      connectionId: profile.id,
      publish: (request) => this.publish(request),
      emit: (event) => sink.repeat(event),
      log,
      check: (request) => this.publisher.check(request),
      receiveMaximum: () => this.publisher.receiveMaximum
    })
    this.link = new SessionLink({
      profile,
      ctx,
      log,
      status: this.status,
      diagnostics,
      subscriptions: this.subscriptions,
      publisher: this.publisher,
      jobs: this.jobs,
      pushMessage: options.pushMessage,
      connect: options.connect,
      readFile: options.readFile,
      onConnected: options.onConnected
    })
    for (const sub of profile.subscriptions) {
      if (sub.enabled) this.subscriptions.want(sub)
    }
  }

  get state(): ConnectionStatus {
    return this.status.state
  }

  get isConnected(): boolean {
    return this.link.isConnected
  }

  /** True once the session ended (`disconnected` / `error`): it holds no client anymore. */
  get isFinished(): boolean {
    return this.link.isFinished
  }

  /**
   * Starts the connection attempt; progress and failures are reported as status events.
   * Resolves once the client was started or the attempt failed (after the TLS files were read,
   * for TLS profiles that name any); never rejects.
   */
  connect(): Promise<void> {
    return this.link.connect()
  }

  /** Graceful disconnect (DISCONNECT packet, forced after `timeoutMs`). Stops repeat jobs. */
  disconnect(timeoutMs = DISCONNECT_TIMEOUT_MS): Promise<void> {
    return this.link.disconnect(timeoutMs)
  }

  /** Subscribes on the live connection; the subscription is restored after reconnects. */
  async subscribe(sub: Subscription): Promise<SubscriptionEvent> {
    const client = this.link.requireClient()
    return this.subscriptions.subscribe(client, sub, this.subscriptions.want(sub))
  }

  /** Unsubscribes; the subscription is no longer restored after reconnects. */
  async unsubscribe(sub: Subscription): Promise<SubscriptionEvent> {
    const client = this.link.requireClient()
    return this.subscriptions.unsubscribe(client, sub, this.subscriptions.drop(sub.id))
  }

  /**
   * Publishes; the message is emitted with direction `out` once it is handed to mqtt.js.
   * Rejects with a human error when a local check (MQTT string sizes, the broker's CONNACK
   * limits) fails (no `out` message then), the broker refuses or the connection goes away.
   */
  async publish(request: PublishRequest): Promise<void> {
    return this.publisher.publish(this.link.requireClient(), request)
  }

  /**
   * Starts a repeat-publish job (options must be validated); returns its id. Throws a human
   * error when the broker cannot take the job's messages (e.g. a topic alias it does not allow).
   * The job pauses while the session reconnects and ends with the session.
   */
  startRepeat(options: RepeatPublishOptions): string {
    this.link.requireClient()
    return this.jobs.start(options)
  }

  /** Stops a running job of this session. Returns false when the id is unknown. */
  stopRepeat(jobId: string): boolean {
    return this.jobs.stop(jobId)
  }

  snapshot(): SessionSnapshot {
    return {
      connectionId: this.connectionId,
      ...this.status.snapshot(),
      subscriptions: this.subscriptions.snapshot(),
      repeatJobs: this.jobs.snapshot()
    }
  }
}
