/**
 * Round-trip times of the live network connection, from the packets mqtt.js reports:
 * PINGREQ → PINGRESP, and QoS 1 PUBLISH → its PUBACK (by packet identifier). Measured with a
 * monotonic clock; forgotten when the connection closes.
 */
import type { Packet } from 'mqtt'

/** QoS 1 publishes timed at once (older ones are dropped first). */
const MAX_TRACKED_PUBLISHES = 1024

export class RoundTrips {
  private pingSentAt: number | undefined
  private readonly publishSentAt = new Map<number, number>()

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** A packet mqtt.js is about to write. */
  sent(packet: Packet): void {
    if (packet.cmd === 'pingreq') {
      this.pingSentAt = this.now()
    } else if (packet.cmd === 'publish' && packet.qos === 1 && packet.messageId !== undefined) {
      // Map order is insertion order: a resent publish moves to the end.
      this.publishSentAt.delete(packet.messageId)
      if (this.publishSentAt.size >= MAX_TRACKED_PUBLISHES) {
        const oldest = this.publishSentAt.keys().next()
        if (!oldest.done) this.publishSentAt.delete(oldest.value)
      }
      this.publishSentAt.set(packet.messageId, this.now())
    }
  }

  /** A packet mqtt.js received; returns the round trip it completes (ms, 0.1 ms steps). */
  received(packet: Packet): number | undefined {
    let sentAt: number | undefined
    if (packet.cmd === 'pingresp') {
      sentAt = this.pingSentAt
      this.pingSentAt = undefined
    } else if (packet.cmd === 'puback' && packet.messageId !== undefined) {
      sentAt = this.publishSentAt.get(packet.messageId)
      this.publishSentAt.delete(packet.messageId)
    }
    if (sentAt === undefined) return undefined
    return Math.round(Math.max(0, this.now() - sentAt) * 10) / 10
  }

  /** The connection closed: nothing in flight is answered anymore. */
  reset(): void {
    this.pingSentAt = undefined
    this.publishSentAt.clear()
  }
}
