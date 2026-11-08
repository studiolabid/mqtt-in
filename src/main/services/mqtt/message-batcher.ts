/**
 * Coalesces messages into batches so the renderer receives one IPC event per
 * ~50 ms instead of one per message.
 */
import type { MqttMessage } from '@shared/models'

export interface MessageBatcherOptions {
  /** Maximum time a message waits before being flushed. Default 50 ms. */
  intervalMs?: number
  /** Batch size that triggers an immediate flush. Default 500. */
  maxBatch?: number
}

export class MessageBatcher {
  private readonly intervalMs: number
  private readonly maxBatch: number
  private queue: MqttMessage[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    private readonly sink: (batch: MqttMessage[]) => void,
    options: MessageBatcherOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? 50
    this.maxBatch = Math.max(1, options.maxBatch ?? 500)
  }

  /** Number of messages waiting to be flushed. */
  get pending(): number {
    return this.queue.length
  }

  /** Queues a message; flushes immediately when the batch is full. Ignored after `dispose()`. */
  push(message: MqttMessage): void {
    if (this.disposed) return
    this.queue.push(message)
    if (this.queue.length >= this.maxBatch) {
      this.flush()
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, this.intervalMs)
    }
  }

  /** Sends every queued message now (no-op when empty). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.queue.length === 0) return
    const batch = this.queue
    this.queue = []
    try {
      this.sink(batch)
    } catch (err) {
      console.error('[mqtt] Failed to deliver a message batch', err)
    }
  }

  /** Flushes what is queued and stops accepting messages. */
  dispose(): void {
    this.flush()
    this.disposed = true
  }
}
