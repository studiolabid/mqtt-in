/**
 * Repeat publishing: renders the payload template (unless `useTemplate` is false), encodes and
 * publishes it on a drift-free schedule until `count` messages were sent or the job is stopped.
 *
 * Schedule: message n of a segment is due at `anchorAt + n × interval`. Timers on Windows fire
 * in ~15.6 ms steps, so one timer callback sends every message due by then (at most MAX_BURST);
 * a job further behind than MAX_CATCH_UP_MS (a stalled event loop) skips the missed messages
 * instead of bursting. While saturated (MAX_IN_FLIGHT, or the broker's Receive Maximum for QoS
 * 1/2) ticks are skipped. While the session reconnects the job is paused: nothing is sent,
 * messages lost with the connection are sent again, and the schedule restarts on resume.
 */
import { LIMITS } from '@shared/defaults'
import type {
  PublishRequest,
  RepeatJobEvent,
  RepeatJobState,
  RepeatPublishOptions
} from '@shared/models'
import { encodePayload } from '@shared/payload'
import { hasTemplate, renderTemplate } from '@shared/template'
import { errorMessage } from '../../utils/errors'

/** Publishes allowed in flight at once (at most); ticks are skipped while saturated. */
export const MAX_IN_FLIGHT = 64
/** Minimum delay between two progress events of a running job. */
export const PROGRESS_INTERVAL_MS = 250
/** Messages one timer callback may send to catch up with the schedule (coarse timers). */
export const MAX_BURST = 4
/** Further behind the schedule than this, missed messages are skipped (no burst). */
export const MAX_CATCH_UP_MS = 100

export interface RepeatJobParams {
  id: string
  connectionId: string
  options: RepeatPublishOptions
  publish: (request: PublishRequest) => Promise<void>
  onEvent: (event: RepeatJobEvent) => void
  /**
   * How many publishes may be in flight at once, read before every dispatch: MAX_IN_FLIGHT by
   * default, lower for QoS 1/2 on a broker with a smaller Receive Maximum.
   */
  maxInFlight?: () => number
  /** Wall clock for event timestamps (defaults to `Date.now`). */
  now?: () => number
  /** Monotonic clock for the schedule (defaults to `performance.now`). */
  clock?: () => number
}

/** Whether every tick renders the payload (templates enabled and present). */
function rendersTemplate(options: RepeatPublishOptions): boolean {
  return options.useTemplate !== false && hasTemplate(options.payload)
}

/**
 * Checks the options a job is started with. Renders (unless `useTemplate` is false) and
 * encodes the payload once so invalid templates fail before the first tick. Throws a human
 * error.
 */
export function assertRepeatOptions(options: RepeatPublishOptions): void {
  const { min, max } = LIMITS.repeatIntervalMs
  if (
    !Number.isFinite(options.intervalMs) ||
    options.intervalMs < min ||
    options.intervalMs > max
  ) {
    throw new Error(`Interval must be between ${min} ms and ${max / 3_600_000} h`)
  }
  if (!Number.isSafeInteger(options.count) || options.count < 0) {
    throw new Error('Count must be a whole number (0 = until stopped)')
  }
  const sample = rendersTemplate(options)
    ? renderTemplate(options.payload, { counter: 1 })
    : options.payload
  encodePayload(sample, options.format)
}

export class RepeatJob {
  readonly id: string
  readonly connectionId: string
  private readonly options: RepeatPublishOptions
  private readonly publishFn: (request: PublishRequest) => Promise<void>
  private readonly onEvent: (event: RepeatJobEvent) => void
  private readonly maxInFlight: () => number
  private readonly now: () => number
  private readonly clock: () => number
  /** Encoded once when nothing is rendered (no template tokens, or `useTemplate: false`). */
  private readonly staticPayload: Uint8Array | null
  private state: RepeatJobState = 'running'
  private error: string | undefined
  private started = false
  private paused = false
  private sent = 0
  private dispatched = 0
  private inFlight = 0
  /** Start of the current schedule segment, and the messages dispatched in it. */
  private anchorAt = 0
  private anchorCount = 0
  private lastDispatchAt = Number.NEGATIVE_INFINITY
  private lastEmitAt = Number.NEGATIVE_INFINITY
  private tickTimer: ReturnType<typeof setTimeout> | null = null
  private progressTimer: ReturnType<typeof setTimeout> | null = null

  constructor(params: RepeatJobParams) {
    this.id = params.id
    this.connectionId = params.connectionId
    this.options = { ...params.options }
    this.publishFn = params.publish
    this.onEvent = params.onEvent
    this.maxInFlight = params.maxInFlight ?? (() => MAX_IN_FLIGHT)
    this.now = params.now ?? Date.now
    this.clock = params.clock ?? (() => performance.now())
    this.staticPayload = rendersTemplate(this.options)
      ? null
      : encodePayload(this.options.payload, this.options.format)
  }

  get running(): boolean {
    return this.state === 'running'
  }

  /** Emits the initial event and schedules the first publish immediately. */
  start(): void {
    if (this.started) return
    this.started = true
    this.reanchor(this.clock())
    this.emit()
    this.tickTimer = setTimeout(() => this.tick(), 0)
  }

  /** Stops the job (`stopped`). No-op once the job has finished. */
  stop(): void {
    if (this.state === 'running') this.finish('stopped')
  }

  /** The connection dropped and the session reconnects: nothing is sent until `resume()`. */
  pause(): void {
    if (this.state !== 'running' || this.paused) return
    this.paused = true
    this.clearTick()
  }

  /** Connected again: a new schedule starts, at least one interval after the last message. */
  resume(): void {
    if (this.state !== 'running' || !this.paused) return
    this.paused = false
    if (!this.started) return
    const now = this.clock()
    const at = Math.max(now, this.lastDispatchAt + this.options.intervalMs)
    this.reanchor(at)
    this.tickTimer = setTimeout(() => this.tick(), at - now)
  }

  /** The request of the first tick (rendered with counter 1), for checks before `start()`. */
  firstRequest(): PublishRequest {
    const payload =
      this.staticPayload ??
      encodePayload(renderTemplate(this.options.payload, { counter: 1 }), this.options.format)
    return this.request(payload)
  }

  /** The job's current state as an event. */
  snapshot(): RepeatJobEvent {
    const event: RepeatJobEvent = {
      jobId: this.id,
      connectionId: this.connectionId,
      topic: this.options.topic,
      state: this.state,
      sent: this.sent,
      total: this.options.count,
      intervalMs: this.options.intervalMs,
      timestamp: this.now()
    }
    if (this.error !== undefined) event.error = this.error
    return event
  }

  private get allDispatched(): boolean {
    return this.options.count > 0 && this.dispatched >= this.options.count
  }

  private reanchor(at: number): void {
    this.anchorAt = at
    this.anchorCount = 0
  }

  private tick(): void {
    this.tickTimer = null
    if (this.state !== 'running' || this.paused || this.allDispatched) return
    const interval = this.options.intervalMs
    const now = this.clock()
    const dueAt = this.anchorAt + this.anchorCount * interval
    if (now < dueAt) {
      this.schedule(dueAt, now) // fired early: wait for the due time
      return
    }
    if (now - dueAt > MAX_CATCH_UP_MS) this.reanchor(now) // stalled: skip what was missed
    const due = Math.floor((now - this.anchorAt) / interval) + 1 - this.anchorCount
    const cap = Math.max(1, Math.min(MAX_IN_FLIGHT, this.maxInFlight()))
    let dispatched = 0
    while (dispatched < Math.min(due, MAX_BURST) && this.canDispatch(cap)) {
      this.dispatch(now)
      dispatched++
    }
    if (this.state !== 'running' || this.allDispatched) return // in-flight ones complete it
    // Saturated: skip this message, try again one interval later.
    if (dispatched === 0) this.reanchor(now + interval)
    this.schedule(this.anchorAt + this.anchorCount * interval, now)
  }

  private canDispatch(cap: number): boolean {
    return this.state === 'running' && !this.allDispatched && this.inFlight < cap
  }

  private schedule(at: number, now: number): void {
    this.tickTimer = setTimeout(() => this.tick(), Math.max(0, at - now))
  }

  private dispatch(now: number): void {
    const counter = this.dispatched + 1
    let payload: Uint8Array
    try {
      payload =
        this.staticPayload ??
        encodePayload(renderTemplate(this.options.payload, { counter }), this.options.format)
    } catch (err) {
      this.finish('error', `Message ${counter}: ${errorMessage(err)}`)
      return
    }
    this.dispatched = counter
    this.anchorCount++
    this.lastDispatchAt = now
    this.inFlight++
    this.publishFn(this.request(payload)).then(
      () => this.onPublished(),
      (err: unknown) => this.onFailed(err)
    )
  }

  private request(payload: Uint8Array): PublishRequest {
    const { topic, qos, retain, properties } = this.options
    const request: PublishRequest = { topic, payload, qos, retain }
    if (properties) request.properties = properties
    return request
  }

  private onPublished(): void {
    this.inFlight--
    if (this.state !== 'running') return
    this.sent++
    if (this.options.count > 0 && this.sent >= this.options.count) this.finish('completed')
    else this.emitProgress()
  }

  private onFailed(err: unknown): void {
    this.inFlight--
    if (this.state !== 'running') return
    if (this.paused) {
      // Lost with the connection (QoS 0, or still waiting for a send slot): not an error, the
      // message goes out again after the reconnect.
      this.dispatched--
      return
    }
    this.finish('error', errorMessage(err))
  }

  /** Emits at most every PROGRESS_INTERVAL_MS; a trailing event reports the latest count. */
  private emitProgress(): void {
    const wait = this.lastEmitAt + PROGRESS_INTERVAL_MS - this.clock()
    if (wait <= 0) {
      this.emit()
    } else if (!this.progressTimer) {
      this.progressTimer = setTimeout(() => {
        this.progressTimer = null
        if (this.state === 'running') this.emit()
      }, wait)
    }
  }

  private clearTick(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer)
    this.tickTimer = null
  }

  private finish(state: Exclude<RepeatJobState, 'running'>, error?: string): void {
    this.state = state
    this.error = error
    this.clearTick()
    if (this.progressTimer) clearTimeout(this.progressTimer)
    this.progressTimer = null
    this.emit()
  }

  private emit(): void {
    this.lastEmitAt = this.clock()
    this.onEvent(this.snapshot())
  }
}
