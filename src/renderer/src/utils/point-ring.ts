/**
 * Fixed-size ring of `[time, value]` points in typed arrays (pure, no Vue). Used by the pins
 * store: a pinned value keeps its newest points independently of the message ring buffer.
 */

/** Points oldest first: `times[i]` / `values[i]` for `i < length`. */
export interface PointSeries {
  times: Float64Array
  values: Float64Array
  length: number
}

export class PointRing {
  private readonly times: Float64Array
  private readonly values: Float64Array
  /** Index of the oldest point. */
  private start = 0
  private count = 0

  constructor(readonly capacity: number) {
    const size = Math.max(1, Math.floor(capacity))
    this.times = new Float64Array(size)
    this.values = new Float64Array(size)
  }

  get length(): number {
    return this.count
  }

  /** Appends a point; the oldest is overwritten when full. */
  push(time: number, value: number): void {
    const size = this.times.length
    const at = (this.start + this.count) % size
    this.times[at] = time
    this.values[at] = value
    if (this.count < size) this.count++
    else this.start = (this.start + 1) % size
  }

  /** A copy of the points, oldest first. */
  series(): PointSeries {
    const times = new Float64Array(this.count)
    const values = new Float64Array(this.count)
    const size = this.times.length
    const head = Math.min(this.count, size - this.start)
    times.set(this.times.subarray(this.start, this.start + head))
    values.set(this.values.subarray(this.start, this.start + head))
    if (head < this.count) {
      times.set(this.times.subarray(0, this.count - head), head)
      values.set(this.values.subarray(0, this.count - head), head)
    }
    return { times, values, length: this.count }
  }

  /** The point `back` steps before the newest (0 = the newest), or undefined. */
  at(back: number): { time: number; value: number } | undefined {
    if (back < 0 || back >= this.count) return undefined
    const index = (this.start + this.count - 1 - back) % this.times.length
    return { time: this.times[index], value: this.values[index] }
  }

  clear(): void {
    this.start = 0
    this.count = 0
  }
}
