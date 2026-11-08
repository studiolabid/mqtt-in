/**
 * Auto-reconnect of a session: exponential backoff — every failed attempt doubles the wait (up
 * to MAX_BACKOFF_MS, or the profile's period when that is longer), each wait gets ±20 % jitter so
 * clients dropped together do not retry together, and a CONNACK starts over at the profile's
 * period.
 *
 * mqtt.js reads `client.options.reconnectPeriod` when it schedules the next attempt (on close,
 * or right after a refused CONNACK), so `Reconnects` sets the next wait whenever an attempt
 * starts.
 */
import type { MqttClient } from 'mqtt'
import { LIMITS } from '@shared/defaults'
import type { SessionLog } from './session-log'

/** Longest wait between two attempts (unless the profile asks for a longer period). */
export const MAX_BACKOFF_MS = 60_000
/** Each wait is the nominal one ± this share. */
export const BACKOFF_JITTER = 0.2

export class ReconnectBackoff {
  private nominal: number
  private readonly max: number

  /**
   * @param base the profile's reconnect period (ms, > 0)
   * @param random jitter source, 0 <= x < 1 (0.5 = no jitter)
   */
  constructor(
    private readonly base: number,
    private readonly random: () => number = () => Math.random()
  ) {
    this.nominal = base
    this.max = Math.max(base, MAX_BACKOFF_MS)
  }

  /** The wait after the attempt that starts now; the one after it is twice as long. */
  next(): number {
    const jitter = 1 + (this.random() * 2 - 1) * BACKOFF_JITTER
    const wait = Math.round(this.nominal * jitter)
    this.nominal = Math.min(this.nominal * 2, this.max)
    return Math.min(this.max, Math.max(LIMITS.reconnectPeriodMs.min, wait))
  }

  /** A CONNACK: the next wait is the profile's period again. */
  reset(): void {
    this.nominal = this.base
  }
}

/** The waits mqtt.js uses between the attempts of one client, and their log lines. */
export class Reconnects {
  private readonly backoff: ReconnectBackoff
  /** Attempts since the last CONNACK. */
  private attempts = 0

  constructor(
    period: number,
    private readonly log: SessionLog
  ) {
    this.backoff = new ReconnectBackoff(period)
  }

  /** The client's first attempt starts. */
  started(client: MqttClient): void {
    this.plan(client)
  }

  /** mqtt.js starts another attempt (its `reconnect` event). */
  attempt(client: MqttClient): void {
    this.attempts += 1
    this.plan(client)
    this.log('warn', `Reconnecting (attempt ${this.attempts})…`)
  }

  /** A CONNACK: the wait after a later drop is the profile's period again. */
  connected(client: MqttClient): void {
    this.attempts = 0
    this.backoff.reset()
    this.plan(client)
  }

  /** The connection closed; mqtt.js waits as planned before the next attempt. */
  closed(client: MqttClient, wasConnected: boolean, reason: string): void {
    const wait = formatDelay(client.options.reconnectPeriod ?? 0)
    if (wasConnected) this.log('warn', `Connection lost — reconnecting in ${wait}`, reason)
    else this.log('info', `Retrying in ${wait}`)
  }

  private plan(client: MqttClient): void {
    client.options.reconnectPeriod = this.backoff.next()
  }
}

/** `150 ms`, `4 s`, `7.4 s`, `1 min`: a wait as shown in the log. */
export function formatDelay(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`
  return `${Math.round(ms / 6000) / 10} min`
}
