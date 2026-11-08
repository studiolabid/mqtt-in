/**
 * The connection half of an `MqttSession`: its one mqtt.js client and the lifecycle around it.
 * Starts the client (once the TLS files are read and checked, for TLS profiles that name any),
 * maps the mqtt.js events onto the session parts (status, diagnostics, subscriptions,
 * publisher, jobs), decides between reconnecting and ending, and ends the session.
 *
 * Auto-reconnect backs off exponentially (`Reconnects`, reset by every CONNACK). What retrying
 * cannot fix ends the session at once: fatal CONNACK refusals and TLS errors, and a broker
 * DISCONNECT that says so (another client took the session over, banned, moved, or the same
 * refusal again and again). While reconnecting, repeat jobs are paused. Status machine: see
 * `MqttSession`. Single-use.
 */
import type { IConnackPacket, IDisconnectPacket, MqttClient, Packet } from 'mqtt'
import { protocolLabel } from '@shared/defaults'
import type { ConnectionProfile, MqttMessage } from '@shared/models'
import { brokerInfoOf } from './broker-info'
import { abandonClient, type ClientHandlers, endClient } from './client-lifecycle'
import { type BuiltClientOptions, buildClientOptions } from './client-options'
import { describePacket, type PacketDirection } from './packet-log'
import { describeError, type ErrorContext } from './reason-codes'
import { Reconnects } from './reconnect-backoff'
import { createClient, needsTlsFiles, withTlsMaterial } from './session-client'
import type { SessionDiagnostics } from './session-diagnostics'
import type { SessionJobs } from './session-jobs'
import { incomingMessage, type SessionLog } from './session-log'
import type { SessionPublisher } from './session-publisher'
import type { SessionStatus } from './session-status'
import type { SessionSubscriptions } from './session-subscriptions'
import type { ConnectFn, ReadFileFn } from './types'

export interface SessionLinkDeps {
  /** The session's own copy of the profile. */
  profile: ConnectionProfile
  ctx: ErrorContext
  log: SessionLog
  status: SessionStatus
  diagnostics: SessionDiagnostics
  subscriptions: SessionSubscriptions
  publisher: SessionPublisher
  jobs: SessionJobs
  pushMessage: (message: MqttMessage) => void
  connect?: ConnectFn
  readFile?: ReadFileFn
  /** Called on every successful CONNACK. */
  onConnected?: (connectedAt: number) => void
}

export class SessionLink {
  private client: MqttClient | null = null
  private detach: () => void = () => {}
  /** The waits between attempts; null when auto-reconnect is off. */
  private reconnects: Reconnects | null = null
  private everConnected = false
  private started = false
  private finished = false
  private ending: Promise<void> | null = null

  constructor(private readonly deps: SessionLinkDeps) {}

  get isConnected(): boolean {
    return this.deps.status.state === 'connected' && this.client !== null && this.ending === null
  }

  /** True once the session ended (`disconnected` / `error`): it holds no client anymore. */
  get isFinished(): boolean {
    return this.finished
  }

  /**
   * Starts the connection attempt (`connecting`); progress and failures are reported as status
   * events. Resolves once the client was started or the attempt failed, never rejects: right
   * away, or after the TLS files were read (at most a few seconds, see `loadTlsMaterial`).
   */
  connect(): Promise<void> {
    if (this.started) throw new Error('Session already started')
    this.started = true
    const { profile, status } = this.deps
    let built: BuiltClientOptions
    try {
      built = buildClientOptions(profile)
    } catch (err) {
      this.fail(describeError(err))
      return Promise.resolve()
    }
    status.clientId = built.clientId
    const period = built.options.reconnectPeriod ?? 0
    this.reconnects = period > 0 ? new Reconnects(period, this.deps.log) : null
    status.set('connecting')
    const label = protocolLabel(profile.protocolVersion)
    this.deps.log('info', `Connecting to ${built.url} as ${built.clientId} (${label})…`)
    if (!needsTlsFiles(profile)) {
      this.start(built)
      return Promise.resolve()
    }
    return withTlsMaterial(profile, built, this.deps.readFile).then(
      (ready) => {
        // Disconnected (or replaced) while the files were read: nothing to start.
        if (this.isActive()) this.start(ready)
      },
      (err: unknown) => {
        if (this.isActive()) this.fail(describeError(err))
      }
    )
  }

  /** Graceful disconnect (DISCONNECT packet, forced after `timeoutMs`). Stops repeat jobs. */
  disconnect(timeoutMs: number): Promise<void> {
    if (this.ending) return this.ending
    this.deps.jobs.stopAll()
    const client = this.client
    if (!client) {
      // Finished already, or still reading TLS files (that attempt is dropped).
      if (this.finished) this.deps.status.set('disconnected')
      else this.end('disconnected')
      return Promise.resolve()
    }
    const graceful = this.deps.status.state === 'connected'
    this.deps.status.set('disconnecting')
    this.deps.log('info', 'Disconnecting…')
    this.ending = endClient(client, graceful, timeoutMs).then((clean) => {
      if (!clean) this.deps.log('warn', 'The broker did not complete the disconnect in time')
      this.release()
      this.end('disconnected')
    })
    return this.ending
  }

  /** The client, while connected; throws "Not connected" otherwise. */
  requireClient(): MqttClient {
    if (!this.client || !this.isConnected) throw new Error('Not connected')
    return this.client
  }

  /** mqtt-packet threw half way through a PUBLISH: the stream is corrupt, start over. */
  onWriteFailure(err: unknown): void {
    if (!this.isActive() || !this.client) return
    this.deps.diagnostics.onWriteFailure(err)
    this.client.stream?.destroy()
  }

  /** False once the session is ending: late events of the old client are ignored. */
  private isActive(): boolean {
    return this.ending === null && !this.finished
  }

  /** Creates the client and sends CONNECT; a synchronous refusal ends the attempt in `error`. */
  private start(built: BuiltClientOptions): void {
    try {
      const { client, detach } = createClient(built, this.handlers(), this.deps.connect)
      this.client = client
      this.detach = detach
      this.reconnects?.started(client)
      client.connect()
    } catch (err) {
      // e.g. tls.connect refusing the key: the client has no stream (release() copes with that).
      this.release()
      this.fail(describeError(err, this.deps.ctx))
    }
  }

  private handlers(): ClientHandlers {
    const { profile, subscriptions } = this.deps
    return {
      connect: (packet) => this.onConnect(packet),
      reconnect: () => this.onReconnect(),
      offline: () => {
        if (this.isActive()) subscriptions.resetAll()
      },
      close: () => this.onClose(),
      error: (err) => this.onError(err),
      disconnect: (packet) => this.onServerDisconnect(packet),
      message: (topic, payload, packet) => {
        if (this.finished) return
        this.deps.pushMessage(
          incomingMessage(profile.id, profile.protocolVersion, topic, payload, packet)
        )
      },
      packetsend: (packet) => this.onPacket(packet, 'out'),
      packetreceive: (packet) => this.onPacket(packet, 'in')
    }
  }

  private onConnect(packet: IConnackPacket): void {
    const client = this.client
    if (!client || !this.isActive()) return
    const { profile, diagnostics, publisher, subscriptions, status, jobs } = this.deps
    const first = !this.everConnected
    this.everConnected = true
    diagnostics.connected()
    this.reconnects?.connected(client)
    publisher.onConnected(packet.properties)
    subscriptions.onConnected(packet.properties)
    const at = Date.now()
    status.connected(at, brokerInfoOf(profile.protocolVersion, packet))
    this.deps.log('info', `Connected (session present: ${packet.sessionPresent ? 'yes' : 'no'})`)
    this.deps.onConnected?.(at)
    jobs.resumeAll()
    subscriptions.restore(client, { first, sessionPresent: packet.sessionPresent })
  }

  private onReconnect(): void {
    const client = this.client
    if (!client || !this.isActive()) return
    this.deps.diagnostics.attemptStarted()
    this.deps.status.set('reconnecting', this.deps.diagnostics.lastError)
    this.reconnects?.attempt(client)
  }

  private onClose(): void {
    const client = this.client
    if (!client || !this.isActive()) return
    const { status, diagnostics } = this.deps
    if (!this.reconnects) {
      // No auto-reconnect: the session is over and the reason must stay visible.
      const reason = diagnostics.closeReason('error')
      this.release()
      this.end('error', reason)
      return
    }
    const wasConnected = status.state === 'connected'
    this.deps.jobs.pauseAll()
    // QoS 1/2 publishes stay with mqtt.js, which resends them after reconnecting.
    this.deps.publisher.onClosed(new Error('Connection lost'))
    this.resetConnectionState()
    const reason = diagnostics.closeReason(null)
    this.reconnects.closed(client, wasConnected, reason)
    status.set('reconnecting', reason)
  }

  private onError(err: Error): void {
    if (!this.isActive()) return
    const { message, fatal } = this.deps.diagnostics.onError(err)
    if (fatal) {
      this.release()
      this.end('error', message)
    } else if (this.deps.status.state === 'reconnecting') {
      this.deps.status.set('reconnecting', message)
    }
  }

  /** A broker DISCONNECT (MQTT 5); the socket closes right after it. */
  private onServerDisconnect(packet: IDisconnectPacket): void {
    const client = this.client
    if (!client || !this.isActive()) return
    const outcome = this.deps.diagnostics.onServerDisconnect(packet)
    this.deps.publisher.onServerDisconnect(client, outcome.code, outcome.message)
    if (!outcome.final) return
    // Reconnecting would only repeat it (e.g. two clients with one client id kicking each other).
    this.release()
    this.end('error', outcome.message)
  }

  /** Every packet mqtt.js writes / reads: diagnostics, PUBREC tracking, round trips, debug log. */
  private onPacket(packet: Packet, direction: PacketDirection): void {
    const { diagnostics, publisher, status } = this.deps
    if (direction === 'in') {
      diagnostics.inspectPacket(packet)
      publisher.onPacket(packet)
      status.packetReceived(packet)
    } else {
      const active = (): boolean => this.isActive()
      if (packet.cmd === 'connect') diagnostics.watchStream(this.client?.stream, active)
      status.packetSent(packet)
    }
    const line = describePacket(packet, direction)
    if (line) this.deps.log('debug', line.message, line.detail)
  }

  /** Detaches our listeners and force-closes the client (no reconnects afterwards). */
  private release(): void {
    const client = this.client
    if (!client) return
    this.client = null
    this.detach()
    abandonClient(client)
  }

  /** Ends a session that failed before / while starting. */
  private fail(message: string): void {
    this.deps.log('error', message)
    this.end('error', message)
  }

  /** Forgets what belonged to the closed network connection (when reconnecting and ending). */
  private resetConnectionState(): void {
    this.deps.subscriptions.resetAll()
    this.deps.status.clearConnection()
  }

  /** Final transition of the session (errors are logged by the caller). */
  private end(state: 'disconnected' | 'error', error?: string): void {
    this.finished = true
    this.deps.jobs.stopAll()
    this.deps.publisher.rejectPending(new Error(error ?? 'Disconnected'))
    this.resetConnectionState()
    if (state === 'disconnected') this.deps.log('info', 'Disconnected')
    this.deps.status.set(state, error)
  }
}
