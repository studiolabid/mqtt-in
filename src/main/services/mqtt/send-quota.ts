/**
 * Outbound flow control for QoS 1 / 2 PUBLISHes (MQTT 5 §4.9, MQTT-3.3.4-7): at most Receive
 * Maximum of them may wait for the broker's acknowledgement (PUBACK, PUBCOMP or a refusing
 * PUBREC). Later ones wait here in FIFO order and start as slots come free. mqtt.js 5 has no
 * outbound flow control, so without this a burst gets the client disconnected (0x93).
 *
 * QoS 0 publishes never take a slot. MQTT 3.1.1 has no Receive Maximum: the protocol maximum
 * (65,535) applies.
 */

/** Receive Maximum when the broker announces none (MQTT 5 §3.2.2.3.3). */
export const DEFAULT_RECEIVE_MAXIMUM = 65_535

const noop = (): void => {}

export class SendQuota {
  private max = DEFAULT_RECEIVE_MAXIMUM
  private used = 0
  private isOpen = false
  private draining = false
  /** One ticket per acquire, insertion ordered: first in, first out; cancelling is O(1). */
  private readonly waiting = new Map<object, () => void>()

  /** The broker's Receive Maximum for the current connection. */
  get limit(): number {
    return this.max
  }

  /** Publishes waiting for a slot. */
  get queued(): number {
    return this.waiting.size
  }

  /**
   * A CONNACK: `receiveMaximum` applies from now on (the default when not announced) and queued
   * publishes may start. `inUse` = QoS 1/2 publishes still unacknowledged on this client.
   */
  open(receiveMaximum: number | undefined, inUse: number): void {
    this.max =
      receiveMaximum !== undefined && Number.isInteger(receiveMaximum) && receiveMaximum > 0
        ? Math.min(receiveMaximum, DEFAULT_RECEIVE_MAXIMUM)
        : DEFAULT_RECEIVE_MAXIMUM
    this.used = Math.max(0, inUse)
    this.isOpen = true
    this.drain()
  }

  /** The connection closed or is about to: nothing starts until the next CONNACK. */
  close(): void {
    this.isOpen = false
  }

  /**
   * Calls `start` as soon as a slot is free and every earlier publish started: right away, or
   * later from `release()` / `open()`. Returns a function that cancels a start still waiting.
   */
  acquire(start: () => void): () => void {
    if (this.isOpen && this.used < this.max && this.waiting.size === 0) {
      this.used++
      start()
      return noop
    }
    const ticket = {}
    this.waiting.set(ticket, start)
    return () => {
      this.waiting.delete(ticket)
    }
  }

  /** A started publish finished (acknowledged, refused or dropped): its slot is free again. */
  release(): void {
    if (this.used > 0) this.used--
    this.drain()
  }

  private drain(): void {
    // A start may settle synchronously and call release() again: the outer loop continues.
    if (this.draining) return
    this.draining = true
    try {
      while (this.isOpen && this.used < this.max) {
        const next = this.waiting.entries().next()
        if (next.done) return
        const [ticket, start] = next.value
        this.waiting.delete(ticket)
        this.used++
        start()
      }
    } finally {
      this.draining = false
    }
  }
}
