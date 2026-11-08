/**
 * The repeat-publish jobs of one session (only running jobs are kept). A job whose message the
 * broker cannot take (topic alias, retain or QoS it does not support, too large…) fails at start;
 * QoS 1/2 jobs keep at most the broker's Receive Maximum publishes in flight. While the session
 * reconnects the jobs are paused (they keep their `running` state); they end when the session
 * ends.
 */
import { newId } from '@shared/defaults'
import type { PublishRequest, RepeatJobEvent, RepeatPublishOptions } from '@shared/models'
import { errorMessage } from '../../utils/errors'
import { lowerFirst } from './reason-codes'
import { RepeatJob } from './repeat-job'
import type { SessionLog } from './session-log'

export interface SessionJobsDeps {
  connectionId: string
  publish: (request: PublishRequest) => Promise<void>
  emit: (event: RepeatJobEvent) => void
  log: SessionLog
  /** Throws the human reason a request cannot be published on the connection right now. */
  check: (request: PublishRequest) => void
  /** QoS 1/2 publishes the broker accepts unacknowledged (its Receive Maximum). */
  receiveMaximum: () => number
}

export class SessionJobs {
  private readonly jobs = new Map<string, RepeatJob>()

  constructor(private readonly deps: SessionJobsDeps) {}

  /**
   * Starts a job (options must be validated); returns its id. Throws a human error, without
   * starting, when the broker cannot take the job's first message.
   */
  start(options: RepeatPublishOptions): string {
    const job = new RepeatJob({
      id: newId(),
      connectionId: this.deps.connectionId,
      options,
      publish: this.deps.publish,
      onEvent: (event) => {
        if (event.state !== 'running') this.jobs.delete(event.jobId)
        this.deps.emit(event)
      },
      maxInFlight: options.qos > 0 ? this.deps.receiveMaximum : undefined
    })
    try {
      this.deps.check(job.firstRequest())
    } catch (err) {
      const reason = lowerFirst(errorMessage(err))
      this.deps.log('error', `Cannot start repeat publishing to ${options.topic}: ${reason}`)
      throw err
    }
    this.jobs.set(job.id, job)
    const count = options.count > 0 ? `${options.count} messages` : 'until stopped'
    this.deps.log(
      'info',
      `Repeat publishing to ${options.topic} every ${options.intervalMs} ms (${count})`
    )
    job.start()
    return job.id
  }

  /** Stops a running job. Returns false when the id is unknown (or already finished). */
  stop(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    job.stop()
    return true
  }

  stopAll(): void {
    for (const job of [...this.jobs.values()]) job.stop()
    this.jobs.clear()
  }

  /** The connection dropped and the session reconnects: no job sends until `resumeAll()`. */
  pauseAll(): void {
    for (const job of this.jobs.values()) job.pause()
  }

  /** Connected again (CONNACK): every paused job continues on a new schedule. */
  resumeAll(): void {
    for (const job of this.jobs.values()) job.resume()
  }

  snapshot(): RepeatJobEvent[] {
    return [...this.jobs.values()].map((job) => job.snapshot())
  }
}
