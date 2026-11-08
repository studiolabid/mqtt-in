/**
 * Repeat-publishing jobs (they run in the main process; this tracks their state).
 * Internal helper of `usePublishStore`; runs inside the store's effect scope.
 */
import { ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { MqttProtocolVersion, RepeatJobEvent, RepeatPublishOptions } from '@shared/models'
import { LIMITS } from '@shared/defaults'
import { encodePayload } from '@shared/payload'
import { renderTemplate } from '@shared/template'
import { validateTopicName } from '@shared/topic'
import { api, errorMessage } from '@/services/api'
import type { PublishDraft, RepeatSettings } from '@/types'
import { toPlain } from '@/utils/plain'
import { cleanPublishProperties } from '@/utils/publish'

/** Finished jobs kept per connection (running jobs are always kept). */
const FINISHED_JOBS_KEPT = 10

export interface RepeatJobsDeps {
  draft(connectionId: string): PublishDraft
  protocolVersion(connectionId: string): MqttProtocolVersion
}

export interface RepeatJobs {
  /** Every known job by id. */
  jobs: Ref<Record<string, RepeatJobEvent>>
  jobsFor(connectionId: string): RepeatJobEvent[]
  activeJobFor(connectionId: string): RepeatJobEvent | undefined
  startRepeat(connectionId: string, settings: RepeatSettings): Promise<string | null>
  stopRepeat(jobId: string): Promise<boolean>
  handleRepeat(event: RepeatJobEvent): void
  forgetJobs(connectionId: string): void
}

export function createRepeatJobs(deps: RepeatJobsDeps): RepeatJobs {
  const jobs = ref<Record<string, RepeatJobEvent>>({})

  /** Jobs of a connection, newest first. */
  function jobsFor(connectionId: string): RepeatJobEvent[] {
    return Object.values(jobs.value)
      .filter((job) => job.connectionId === connectionId)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  /** The newest running job of a connection. */
  function activeJobFor(connectionId: string): RepeatJobEvent | undefined {
    return jobsFor(connectionId).find((job) => job.state === 'running')
  }

  /**
   * Starts publishing the current draft repeatedly. The payload is sent as authored: when the
   * draft's `useTemplate` is on, the main process renders template tokens on every tick
   * ({{counter}} counts up); otherwise every message carries the text as is.
   *
   * @returns the job id, or null (after a toast) when invalid or refused.
   */
  async function startRepeat(
    connectionId: string,
    settings: RepeatSettings
  ): Promise<string | null> {
    const draft = toPlain(deps.draft(connectionId))
    const topicError = validateTopicName(draft.topic)
    if (topicError) {
      toast.error(topicError)
      return null
    }
    try {
      // Fail fast with a clear message instead of an error on the first tick.
      const sample = draft.useTemplate
        ? renderTemplate(draft.payload, { counter: 1 })
        : draft.payload
      encodePayload(sample, draft.format)
    } catch (err) {
      toast.error(errorMessage(err))
      return null
    }

    const { min, max } = LIMITS.repeatIntervalMs
    const intervalMs = Math.min(max, Math.max(min, Math.round(settings.intervalMs) || min))
    const count = Math.max(0, Math.floor(settings.count) || 0)
    const options: RepeatPublishOptions = {
      topic: draft.topic,
      payload: draft.payload,
      format: draft.format,
      useTemplate: draft.useTemplate,
      qos: draft.qos,
      retain: draft.retain,
      intervalMs,
      count
    }
    if (deps.protocolVersion(connectionId) === 5) {
      const properties = cleanPublishProperties(draft.properties)
      if (properties) options.properties = properties
    }

    try {
      const jobId = await api.mqtt.startRepeat(connectionId, options)
      if (!jobs.value[jobId]) {
        jobs.value[jobId] = {
          jobId,
          connectionId,
          topic: draft.topic,
          state: 'running',
          sent: 0,
          total: count,
          intervalMs,
          timestamp: Date.now()
        }
      }
      return jobId
    } catch (err) {
      toast.error('Could not start repeat publishing', { description: errorMessage(err) })
      return null
    }
  }

  /** Stops a job. @returns false (after a toast) when the main process refused. */
  async function stopRepeat(jobId: string): Promise<boolean> {
    try {
      await api.mqtt.stopRepeat(jobId)
      const job = jobs.value[jobId]
      if (job?.state === 'running') {
        jobs.value[jobId] = { ...job, state: 'stopped', timestamp: Date.now() }
      }
      return true
    } catch (err) {
      toast.error('Could not stop repeat publishing', { description: errorMessage(err) })
      return false
    }
  }

  /** Applies a job event; failures are reported with a toast. */
  function handleRepeat(event: RepeatJobEvent): void {
    const previous = jobs.value[event.jobId]
    // A finished job never runs again: ignore late progress events.
    if (previous && previous.state !== 'running' && event.state === 'running') return
    jobs.value[event.jobId] = { ...event }
    if (event.state === 'error' && previous?.state !== 'error') {
      toast.error(`Repeat publishing to ${event.topic} stopped`, { description: event.error })
    }
    if (event.state !== 'running') pruneFinished(event.connectionId)
  }

  /** Drops the jobs of a deleted connection. */
  function forgetJobs(connectionId: string): void {
    for (const job of Object.values(jobs.value)) {
      if (job.connectionId === connectionId) delete jobs.value[job.jobId]
    }
  }

  function pruneFinished(connectionId: string): void {
    const finished = jobsFor(connectionId).filter((job) => job.state !== 'running')
    for (const job of finished.slice(FINISHED_JOBS_KEPT)) delete jobs.value[job.jobId]
  }

  return { jobs, jobsFor, activeJobFor, startRepeat, stopRepeat, handleRepeat, forgetJobs }
}
