/**
 * Sliding-window throughput meter (pure, no Vue).
 *
 * Counts are recorded as they happen; `tick()` (called about once per second) closes the
 * current sample. The rate is the average over the last `windowSize` samples, weighted by the
 * real time between ticks, so throttled or late timers still report correct values.
 */

interface Sample {
  count: number
  ms: number
}

export class RateMeter {
  private samples: Sample[] = []
  private pending = 0
  private lastTickAt: number | undefined
  private current = 0

  /**
   * @param windowSize number of samples to average (5 ticks of 1 s = 5 s window)
   * @param nominalMs assumed duration of the first sample after a quiet period
   */
  constructor(
    private readonly windowSize = 5,
    private readonly nominalMs = 1000
  ) {}

  /** Messages per second over the window (0 when idle). */
  get rate(): number {
    return this.current
  }

  /** True while there is anything left to report (pending counts or a non-zero window). */
  get active(): boolean {
    return this.pending > 0 || this.samples.length > 0
  }

  /** Records `count` events. */
  record(count = 1): void {
    if (count > 0) this.pending += count
  }

  /**
   * Closes the current sample and recomputes the rate.
   *
   * @returns whether the meter is still active (the caller may stop its timer when false).
   */
  tick(now = Date.now()): boolean {
    if (!this.active) {
      this.lastTickAt = undefined
      this.current = 0
      return false
    }
    const elapsed = this.lastTickAt === undefined ? this.nominalMs : now - this.lastTickAt
    this.lastTickAt = now
    this.samples.push({ count: this.pending, ms: Math.max(1, elapsed) })
    this.pending = 0
    if (this.samples.length > this.windowSize) this.samples.shift()

    let count = 0
    let ms = 0
    for (const sample of this.samples) {
      count += sample.count
      ms += sample.ms
    }
    if (count === 0) {
      // A full quiet window: the rate has decayed to zero.
      this.reset()
      return false
    }
    this.current = (count * 1000) / ms
    return true
  }

  /** Forgets everything. */
  reset(): void {
    this.samples = []
    this.pending = 0
    this.lastTickAt = undefined
    this.current = 0
  }
}
