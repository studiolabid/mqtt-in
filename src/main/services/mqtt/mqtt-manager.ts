/**
 * Owns one `MqttSession` per connection id and routes every MQTT use case to it.
 * All events go to an injected `EventSink` (messages through a shared batcher).
 *
 * Per connection it also remembers the filters the broker may still hold (granted SUBACKs of
 * every session of this app run, minus the confirmed UNSUBSCRIBEs): a later session that
 * resumes the persistent broker session unsubscribes the ones it no longer wants.
 */
import type {
  PublishRequest,
  RepeatPublishOptions,
  SessionSnapshot,
  Subscription,
  SubscriptionEvent
} from '@shared/models'
import { MessageBatcher, type MessageBatcherOptions } from './message-batcher'
import { MqttSession } from './mqtt-session'
import type { ConnectFn, EventSink, ProfileSource, ReadFileFn } from './types'

export interface MqttManagerOptions {
  /** Persisted profiles (the renderer saves before connecting). */
  profiles: ProfileSource
  sink: EventSink
  connect?: ConnectFn
  /** Reads TLS files (default: `readTlsFile`, asynchronous with a size cap and a timeout). */
  readFile?: ReadFileFn
  /** Called on every successful CONNACK (e.g. to record `lastConnectedAt`). */
  onConnected?: (connectionId: string, connectedAt: number) => void
  batcher?: MessageBatcherOptions
}

const noop = (): void => {}

export class MqttManager {
  private readonly sessions = new Map<string, MqttSession>()
  /** Filters the broker may hold per connection id, across its sessions (this app run only). */
  private readonly subscribedFilters = new Map<string, Set<string>>()
  /** Serializes connect / disconnect / forget per connection id. */
  private readonly queues = new Map<string, Promise<void>>()
  private readonly batcher: MessageBatcher
  private disposed = false

  constructor(private readonly options: MqttManagerOptions) {
    this.batcher = new MessageBatcher((batch) => options.sink.messages(batch), options.batcher)
  }

  /**
   * Connects the persisted profile `connectionId`, replacing (disconnecting) an existing
   * session first. Resolves once the attempt has started (status `connecting`); everything
   * after that, TLS file problems included, is reported as status events. Throws "Connection
   * not found".
   */
  connect(connectionId: string): Promise<void> {
    return this.exclusive(connectionId, async () => {
      if (this.disposed) throw new Error('The app is shutting down')
      const profile = this.options.profiles.get(connectionId)
      if (!profile) throw new Error('Connection not found')
      // A finished session (e.g. `error`) has nothing to close: replacing it must not report
      // `disconnected` between the renderer's optimistic `connecting` and the new attempt.
      const previous = this.sessions.get(connectionId)
      if (previous && !previous.isFinished) await previous.disconnect()
      let subscribedFilters = this.subscribedFilters.get(connectionId)
      if (!subscribedFilters) {
        subscribedFilters = new Set()
        this.subscribedFilters.set(connectionId, subscribedFilters)
      }
      const session = new MqttSession({
        profile,
        sink: this.options.sink,
        pushMessage: (message) => this.batcher.push(message),
        connect: this.options.connect,
        readFile: this.options.readFile,
        onConnected: (at) => this.options.onConnected?.(connectionId, at),
        subscribedFilters
      })
      this.sessions.set(connectionId, session)
      // Not awaited: a TLS profile reads its files first (up to a few seconds on a slow network
      // share), and a disconnect or a new connect must not queue behind that.
      session.connect().catch((err: unknown) => {
        console.error('[mqtt] Unexpected connect failure', err)
      })
    })
  }

  /** Graceful disconnect (cancels auto-reconnect and repeat jobs). No-op when unknown. */
  disconnect(connectionId: string): Promise<void> {
    return this.exclusive(connectionId, async () => {
      await this.sessions.get(connectionId)?.disconnect()
    })
  }

  /** Disconnects and drops the session (the profile was deleted). */
  forget(connectionId: string): Promise<void> {
    return this.exclusive(connectionId, async () => {
      const session = this.sessions.get(connectionId)
      this.sessions.delete(connectionId)
      this.subscribedFilters.delete(connectionId)
      await session?.disconnect()
    })
  }

  /** Subscribes on the connected session; resolves with the final state. Rejects "Not connected". */
  async subscribe(connectionId: string, subscription: Subscription): Promise<SubscriptionEvent> {
    return this.connected(connectionId).subscribe(subscription)
  }

  /** Unsubscribes on the connected session; resolves with the final state. Rejects "Not connected". */
  async unsubscribe(connectionId: string, subscription: Subscription): Promise<SubscriptionEvent> {
    return this.connected(connectionId).unsubscribe(subscription)
  }

  /** Rejects with "Not connected" or the broker's refusal. */
  async publish(connectionId: string, request: PublishRequest): Promise<void> {
    return this.connected(connectionId).publish(request)
  }

  /**
   * Starts a repeat-publish job on a connected session; returns the job id (throws when not
   * connected). The options must be validated (`parseRepeatOptions` in the IPC layer runs
   * `assertRepeatOptions`; it is not repeated here).
   */
  startRepeat(connectionId: string, options: RepeatPublishOptions): string {
    return this.connected(connectionId).startRepeat(options)
  }

  /** Stops a repeat job. Unknown (e.g. already finished) jobs are ignored. */
  stopRepeat(jobId: string): void {
    for (const session of this.sessions.values()) {
      if (session.stopRepeat(jobId)) return
    }
  }

  /** Snapshot of every known session (survives renderer reloads). */
  getSessions(): SessionSnapshot[] {
    return [...this.sessions.values()].map((session) => session.snapshot())
  }

  /**
   * Disconnects every session, bounded by `timeoutMs`, then flushes pending messages.
   * Never rejects. Further `connect` calls are refused.
   */
  async disposeAll(timeoutMs = 1500): Promise<void> {
    this.disposed = true
    const sessionTimeout = Math.max(0, timeoutMs - 100)
    const all = Promise.all(
      [...this.sessions.values()].map((session) => session.disconnect(sessionTimeout).catch(noop))
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })
    try {
      await Promise.race([all, deadline])
    } finally {
      if (timer) clearTimeout(timer)
      this.batcher.dispose()
    }
  }

  private connected(connectionId: string): MqttSession {
    const session = this.sessions.get(connectionId)
    if (!session || !session.isConnected) throw new Error('Not connected')
    return session
  }

  private exclusive(connectionId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(connectionId) ?? Promise.resolve()
    const run = previous.then(task)
    const settled = run.catch(noop)
    this.queues.set(connectionId, settled)
    void settled.then(() => {
      if (this.queues.get(connectionId) === settled) this.queues.delete(connectionId)
    })
    return run
  }
}
