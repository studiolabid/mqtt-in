/**
 * Per-connection message ring buffer with traffic statistics (pure, no Vue).
 *
 * Storage is a plain array, oldest first. Two budgets bound it: a message count (`capacity`,
 * the `maxMessagesPerConnection` setting) and the payload bytes held (`maxBytes`, default
 * `MAX_RETAINED_BYTES`). Payload buffers live outside the JS heap, so without the byte budget a
 * stream of large payloads (camera frames, firmware chunks) would take capacity × payload size.
 * When a budget is exceeded the oldest messages are evicted in chunks (5 % of the budget) so
 * eviction stays cheap at high rates. The newest message is always kept, even when it alone is
 * larger than the byte budget.
 *
 * Every message gets an absolute sequence number: `messages[i]` has sequence `evicted + i`.
 * Consumers (see `FilteredView`) use sequence numbers to update derived lists incrementally.
 */
import type { MqttMessage } from '@shared/models'
import type { ConnectionStats } from '@/types'
import { RateMeter } from './rate-meter'

/** Read-only view of a buffer that incremental consumers can sync from. */
export interface MessageSource {
  /** Retained messages, oldest first. Treat as read-only; it is mutated in place. */
  readonly messages: readonly MqttMessage[]
  /** Sequence number of `messages[0]` (= messages evicted since the last clear). */
  readonly evicted: number
  /** Sequence number after the newest message (= messages appended since the last clear). */
  readonly appended: number
  /** Unique across all buffers and bumped by `clear()`: sequence numbers restart from 0. */
  readonly generation: number
}

export interface MessageBufferOptions {
  /** Payload bytes held at most (default `MAX_RETAINED_BYTES`). */
  maxBytes?: number
}

/** Payload bytes a connection's buffer holds at most (128 MiB). */
export const MAX_RETAINED_BYTES = 128 * 1024 * 1024

/** Smallest capacity accepted (the settings UI enforces `LIMITS.maxMessagesPerConnection`). */
const MIN_CAPACITY = 1
/** Share of a budget evicted at once when the buffer overflows. */
const EVICTION_FRACTION = 0.05
const NOTHING: readonly MqttMessage[] = Object.freeze([])

let nextGeneration = 1

function emptyCounters(): Omit<ConnectionStats, 'inRate' | 'outRate'> {
  return { received: 0, sent: 0, bytesIn: 0, bytesOut: 0, dropped: 0, retainedBytes: 0 }
}

export class MessageBuffer implements MessageSource {
  private items: MqttMessage[] = []
  private evictedCount = 0
  private gen = nextGeneration++
  private max: number
  private readonly maxBytes: number
  /** False once an id arrived out of order (disables the binary search in `findById`). */
  private ordered = true
  private lastId = Number.NEGATIVE_INFINITY
  private readonly inMeter = new RateMeter()
  private readonly outMeter = new RateMeter()
  private counters = emptyCounters()

  constructor(capacity: number, options: MessageBufferOptions = {}) {
    this.max = normalizeCapacity(capacity)
    const bytes = options.maxBytes ?? MAX_RETAINED_BYTES
    this.maxBytes = Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : MAX_RETAINED_BYTES
  }

  get messages(): readonly MqttMessage[] {
    return this.items
  }

  get evicted(): number {
    return this.evictedCount
  }

  get appended(): number {
    return this.evictedCount + this.items.length
  }

  get generation(): number {
    return this.gen
  }

  get capacity(): number {
    return this.max
  }

  /** The byte budget (payload bytes held at most). */
  get byteBudget(): number {
    return this.maxBytes
  }

  /** Messages currently retained. */
  get size(): number {
    return this.items.length
  }

  /** Payload bytes of the messages currently retained. */
  get retainedBytes(): number {
    return this.counters.retainedBytes
  }

  /** Snapshot of the counters and rates (counts include evicted messages). */
  get stats(): ConnectionStats {
    return { ...this.counters, inRate: this.inMeter.rate, outRate: this.outMeter.rate }
  }

  /** True while the rate meters still have something to report. */
  get ratesActive(): boolean {
    return this.inMeter.active || this.outMeter.active
  }

  /**
   * Appends a batch (in order) and evicts the oldest messages while over a budget.
   *
   * @returns the evicted messages, oldest first (empty when nothing was evicted).
   */
  push(batch: readonly MqttMessage[]): readonly MqttMessage[] {
    if (batch.length === 0) return NOTHING
    let received = 0
    let sent = 0
    let bytes = 0
    for (const message of batch) {
      this.items.push(message)
      if (message.id <= this.lastId) this.ordered = false
      this.lastId = message.id
      const size = message.payload.byteLength
      bytes += size
      if (message.direction === 'out') {
        sent++
        this.counters.bytesOut += size
      } else {
        received++
        this.counters.bytesIn += size
      }
    }
    this.counters.received += received
    this.counters.sent += sent
    this.counters.retainedBytes += bytes
    this.inMeter.record(received)
    this.outMeter.record(sent)

    const overCount = this.items.length > this.max
    const overBytes = this.counters.retainedBytes > this.maxBytes
    if (!overCount && !overBytes) return NOTHING
    let count = 0
    if (overCount) {
      const chunk = Math.max(1, Math.floor(this.max * EVICTION_FRACTION))
      count = Math.min(this.items.length - 1, this.items.length - this.max + chunk)
    }
    if (overBytes) {
      const target = Math.floor(this.maxBytes * (1 - EVICTION_FRACTION))
      count = Math.max(count, this.countToFit(target))
    }
    return this.evict(count)
  }

  /**
   * Changes the capacity; shrinking evicts the oldest messages immediately.
   *
   * @returns the evicted messages, oldest first.
   */
  setCapacity(capacity: number): readonly MqttMessage[] {
    this.max = normalizeCapacity(capacity)
    return this.items.length > this.max ? this.evict(this.items.length - this.max) : NOTHING
  }

  /** Advances the rate meters (call about once per second). Returns `ratesActive`. */
  tick(now = Date.now()): boolean {
    const inActive = this.inMeter.tick(now)
    const outActive = this.outMeter.tick(now)
    return inActive || outActive
  }

  /** Removes every message and resets the statistics. Starts a new generation. */
  clear(): void {
    this.items = []
    this.evictedCount = 0
    this.ordered = true
    this.lastId = Number.NEGATIVE_INFINITY
    this.gen = nextGeneration++
    this.counters = emptyCounters()
    this.inMeter.reset()
    this.outMeter.reset()
  }

  /** Message by id: binary search while ids arrived in order (the normal case), else a scan. */
  findById(id: number): MqttMessage | undefined {
    const items = this.items
    if (!this.ordered) {
      for (let i = items.length - 1; i >= 0; i--) if (items[i].id === id) return items[i]
      return undefined
    }
    let low = 0
    let high = items.length - 1
    while (low <= high) {
      const mid = (low + high) >>> 1
      const value = items[mid].id
      if (value === id) return items[mid]
      if (value < id) low = mid + 1
      else high = mid - 1
    }
    return undefined
  }

  /** Oldest messages to drop so that at most `target` bytes remain (the newest always stays). */
  private countToFit(target: number): number {
    let bytes = this.counters.retainedBytes
    let count = 0
    const keep = this.items.length - 1
    while (count < keep && bytes > target) {
      bytes -= this.items[count].payload.byteLength
      count++
    }
    return count
  }

  private evict(count: number): readonly MqttMessage[] {
    if (count <= 0) return NOTHING
    const removed = this.items.splice(0, count)
    let bytes = 0
    for (const message of removed) bytes += message.payload.byteLength
    this.counters.retainedBytes = Math.max(0, this.counters.retainedBytes - bytes)
    this.evictedCount += removed.length
    this.counters.dropped += removed.length
    return removed
  }
}

function normalizeCapacity(capacity: number): number {
  return Number.isFinite(capacity) ? Math.max(MIN_CAPACITY, Math.floor(capacity)) : MIN_CAPACITY
}
