/**
 * Stale subscriptions of a resumed persistent session (CONNACK session present): the broker
 * keeps every filter the client subscribed, also those disabled or removed while the client was
 * disconnected, and keeps delivering their messages. They are unsubscribed right after the
 * CONNACK. A 0x11 answer (no subscription existed) is normal: the broker had dropped it already.
 */
import type { MqttClient, Packet } from 'mqtt'
import type { LogLevel } from '@shared/models'
import { describeError, lowerFirst } from './reason-codes'
import { ackRefusal, firstAckCode } from './subscription-rules'

export interface StaleFilterDeps {
  log: (level: LogLevel, message: string, detail?: string) => void
  /** Answers arriving after the connection closed are not reported. */
  isConnected: () => boolean
  /** The broker confirmed it holds no subscription for `filter` anymore. */
  removed: (filter: string) => void
}

/** The filters in `candidates` no wanted subscription uses (each once, in order). */
export function staleFilters(candidates: Iterable<string>, wanted: ReadonlySet<string>): string[] {
  const stale = new Set<string>()
  for (const filter of candidates) if (!wanted.has(filter)) stale.add(filter)
  return [...stale]
}

/** Sends one UNSUBSCRIBE per stale filter (no subscription events: nobody shows them). */
export function unsubscribeStale(
  client: MqttClient,
  filters: readonly string[],
  deps: StaleFilterDeps
): void {
  for (const filter of filters) {
    client.unsubscribe(filter, (err?: Error, packet?: Packet) => {
      if (!deps.isConnected()) return
      const code = firstAckCode(packet)
      if (err || (code !== undefined && code >= 0x80)) {
        const reason = err ? describeError(err) : ackRefusal(code ?? 0x80, 5)
        deps.log(
          'warn',
          `Could not remove the stale subscription to ${filter}: ${lowerFirst(reason)}`
        )
        return
      }
      deps.removed(filter)
      if (code === 0x11) {
        deps.log('debug', `No stale subscription to ${filter} was left on the broker`)
      } else {
        deps.log('info', `Removed the stale subscription to ${filter} (resumed session)`)
      }
    })
  }
}
