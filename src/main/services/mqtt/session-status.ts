/**
 * The status half of a session: current state + connection facts (the broker's CONNACK as a
 * `BrokerInfo`, the measured round trip), emitted as `StatusEvent`s. Identical consecutive
 * states are not re-emitted; every CONNACK is. The round trip is measured from the packets the
 * client reports (`RoundTrips`); while connected, a new one is announced with a `connected`
 * event at most every RTT_EVENT_INTERVAL_MS, and only when it changed by at least
 * RTT_EVENT_CHANGE (the latest value is always in the snapshot).
 */
import type { Packet } from 'mqtt'
import type { BrokerInfo, ConnectionStatus, SessionSnapshot, StatusEvent } from '@shared/models'
import { RoundTrips } from './round-trips'

/** Minimum time between two round-trip events of one connection. */
export const RTT_EVENT_INTERVAL_MS = 5000
/** Relative change of the round trip that is worth an event. */
export const RTT_EVENT_CHANGE = 0.1

type StatusFields = Pick<
  SessionSnapshot,
  'status' | 'error' | 'clientId' | 'connectedAt' | 'broker' | 'rttMs'
>

export class SessionStatus {
  /** Current state. */
  state: ConnectionStatus = 'disconnected'
  /** Error shown with the current state (`error`, or the last error while `reconnecting`). */
  error: string | undefined
  /** Effective client id (assigned by the broker when it sent one). */
  clientId: string | undefined
  /** Epoch ms of the last CONNACK, while connected. */
  connectedAt: number | undefined
  sessionPresent: boolean | undefined
  /** The last CONNACK's facts, while connected. */
  broker: BrokerInfo | undefined
  /** Last measured round trip (ms), while connected. */
  rttMs: number | undefined
  /** The round trip of the last event, and when it was sent. */
  private rttAnnounced: { value: number; at: number } | undefined
  private rttTimer: ReturnType<typeof setTimeout> | null = null
  private readonly roundTrips = new RoundTrips()

  constructor(
    private readonly connectionId: string,
    private readonly emit: (event: StatusEvent) => void,
    private readonly now: () => number = Date.now
  ) {}

  /** A packet the client is about to write (PINGREQ / QoS 1 PUBLISH start a round trip). */
  packetSent(packet: Packet): void {
    this.roundTrips.sent(packet)
  }

  /** A packet the client received (PINGRESP / PUBACK complete a round trip). */
  packetReceived(packet: Packet): void {
    const ms = this.roundTrips.received(packet)
    if (ms !== undefined) this.rtt(ms)
  }

  /** Moves to `state`. Every CONNACK is emitted; other repeats are dropped. */
  set(state: ConnectionStatus, error?: string): void {
    if (state !== 'connected' && state === this.state && error === this.error) return
    this.state = state
    this.error = error
    const event: StatusEvent = {
      connectionId: this.connectionId,
      status: state,
      timestamp: this.now()
    }
    if (error !== undefined) event.error = error
    if (this.clientId !== undefined) event.clientId = this.clientId
    if (state === 'connected') {
      if (this.connectedAt !== undefined) event.connectedAt = this.connectedAt
      if (this.sessionPresent !== undefined) event.sessionPresent = this.sessionPresent
      if (this.broker !== undefined) event.broker = { ...this.broker }
      if (this.rttMs !== undefined) event.rttMs = this.rttMs
    }
    this.emit(event)
  }

  /** Records a CONNACK and switches to `connected`. */
  connected(at: number, broker: BrokerInfo): void {
    if (broker.assignedClientId) this.clientId = broker.assignedClientId
    this.connectedAt = at
    this.sessionPresent = broker.sessionPresent
    this.broker = broker
    this.set('connected')
  }

  /** A measured round trip (ms) of the live connection; see RTT_EVENT_INTERVAL_MS. */
  rtt(ms: number): void {
    if (this.state !== 'connected' || !Number.isFinite(ms)) return
    this.rttMs = ms
    if (!this.rttWorthAnnouncing() || this.rttTimer) return
    const wait = this.rttAnnounced ? this.rttAnnounced.at + RTT_EVENT_INTERVAL_MS - this.now() : 0
    if (wait <= 0) {
      this.announceRtt()
      return
    }
    // Too soon after the last event: announce the newest value once the interval passed.
    this.rttTimer = setTimeout(() => {
      this.rttTimer = null
      if (this.state === 'connected' && this.rttWorthAnnouncing()) this.announceRtt()
    }, wait)
  }

  /** Forgets the facts of the last connection (it was closed). */
  clearConnection(): void {
    this.connectedAt = undefined
    this.sessionPresent = undefined
    this.broker = undefined
    this.rttMs = undefined
    this.rttAnnounced = undefined
    this.roundTrips.reset()
    if (this.rttTimer) clearTimeout(this.rttTimer)
    this.rttTimer = null
  }

  /** The status fields of a `SessionSnapshot`. */
  snapshot(): StatusFields {
    const fields: StatusFields = { status: this.state }
    if (this.error !== undefined) fields.error = this.error
    if (this.clientId !== undefined) fields.clientId = this.clientId
    if (this.state === 'connected') {
      if (this.connectedAt !== undefined) fields.connectedAt = this.connectedAt
      if (this.broker !== undefined) fields.broker = { ...this.broker }
      if (this.rttMs !== undefined) fields.rttMs = this.rttMs
    }
    return fields
  }

  /** The first round trip of a connection, or one that changed by RTT_EVENT_CHANGE or more. */
  private rttWorthAnnouncing(): boolean {
    const current = this.rttMs
    if (current === undefined) return false
    const last = this.rttAnnounced?.value
    if (last === undefined) return true
    // 0.1 ms floor: a change from (or to) a round trip of 0 ms still counts.
    return Math.abs(current - last) >= Math.max(last * RTT_EVENT_CHANGE, 0.1)
  }

  private announceRtt(): void {
    if (this.rttMs === undefined) return
    this.rttAnnounced = { value: this.rttMs, at: this.now() }
    this.set('connected')
  }
}
