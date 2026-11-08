import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishRequest, RepeatJobEvent, RepeatPublishOptions } from '@shared/models'
import {
  assertRepeatOptions,
  MAX_IN_FLIGHT,
  RepeatJob
} from '../../../src/main/services/mqtt/repeat-job'

const decoder = new TextDecoder()

function options(overrides: Partial<RepeatPublishOptions> = {}): RepeatPublishOptions {
  return {
    topic: 'sensors/t',
    payload: '{"n": {{counter}}}',
    format: 'json',
    qos: 0,
    retain: false,
    intervalMs: 100,
    count: 3,
    ...overrides
  }
}

function setup(
  opts: RepeatPublishOptions,
  publish: (request: PublishRequest) => Promise<void> = () => Promise.resolve()
): { job: RepeatJob; events: RepeatJobEvent[]; publish: ReturnType<typeof vi.fn> } {
  const events: RepeatJobEvent[] = []
  const spy = vi.fn(publish)
  const job = new RepeatJob({
    id: 'job-1',
    connectionId: 'c1',
    options: opts,
    publish: spy,
    onEvent: (event) => events.push(event)
  })
  return { job, events, publish: spy }
}

function payloads(publish: ReturnType<typeof vi.fn>): string[] {
  return publish.mock.calls.map(([request]) => decoder.decode((request as PublishRequest).payload))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RepeatJob', () => {
  it('publishes `count` rendered messages on the interval, then completes', async () => {
    const { job, events, publish } = setup(options())
    job.start()
    expect(events[0]).toMatchObject({ jobId: 'job-1', state: 'running', sent: 0, total: 3 })

    await vi.advanceTimersByTimeAsync(0)
    expect(publish).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(99)
    expect(publish).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(publish).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)

    expect(payloads(publish)).toEqual(['{"n": 1}', '{"n": 2}', '{"n": 3}'])
    const last = events.at(-1)
    expect(last).toMatchObject({ state: 'completed', sent: 3, total: 3, intervalMs: 100 })
    expect(events.filter((e) => e.state !== 'running')).toHaveLength(1)
    expect(job.running).toBe(false)
  })

  it('passes topic, QoS, retain and properties through', async () => {
    const { job, publish } = setup(
      options({ qos: 1, retain: true, count: 1, properties: { contentType: 'application/json' } })
    )
    job.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(publish.mock.calls[0][0]).toMatchObject({
      topic: 'sensors/t',
      qos: 1,
      retain: true,
      properties: { contentType: 'application/json' }
    })
  })

  it('encodes a static payload once in its format', async () => {
    const { job, publish } = setup(options({ payload: 'de ad', format: 'hex', count: 2 }))
    job.start()
    await vi.advanceTimersByTimeAsync(500)
    const sent = publish.mock.calls.map(([request]) =>
      Array.from((request as PublishRequest).payload)
    )
    expect(sent).toEqual([
      [0xde, 0xad],
      [0xde, 0xad]
    ])
  })

  it('stops on request with a final event', async () => {
    const { job, events, publish } = setup(options({ count: 0 }))
    job.start()
    await vi.advanceTimersByTimeAsync(150)
    expect(publish).toHaveBeenCalledTimes(2)
    job.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(events.at(-1)).toMatchObject({ state: 'stopped', sent: 2, total: 0 })
    job.stop()
    expect(events.filter((e) => e.state === 'stopped')).toHaveLength(1)
  })

  it('ends with an error when a publish fails', async () => {
    let calls = 0
    const { job, events, publish } = setup(options({ count: 10 }), () =>
      ++calls === 2 ? Promise.reject(new Error('Not connected')) : Promise.resolve()
    )
    job.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(events.at(-1)).toMatchObject({ state: 'error', error: 'Not connected', sent: 1 })
  })

  it('ends with an error when a rendered payload cannot be encoded', async () => {
    const { job, events } = setup(options({ payload: '{"v": {{pick(a,b)}}}' }))
    job.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(events.at(-1)?.state).toBe('error')
    expect(events.at(-1)?.error).toMatch(/^Message 1: Invalid JSON/)
  })

  it('skips ticks while too many publishes are in flight', async () => {
    const pending: Array<() => void> = []
    const { job, publish } = setup(
      options({ intervalMs: 10, count: 0 }),
      () => new Promise<void>((resolve) => pending.push(resolve))
    )
    job.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(publish).toHaveBeenCalledTimes(MAX_IN_FLIGHT)
    pending.shift()?.()
    await vi.advanceTimersByTimeAsync(10)
    expect(publish).toHaveBeenCalledTimes(MAX_IN_FLIGHT + 1)
    job.stop()
  })

  it('keeps at most maxInFlight() publishes in flight (the broker Receive Maximum)', async () => {
    const pending: Array<() => void> = []
    let cap = 2
    const events: RepeatJobEvent[] = []
    const publish = vi.fn(() => new Promise<void>((resolve) => pending.push(resolve)))
    const job = new RepeatJob({
      id: 'job-cap',
      connectionId: 'c1',
      options: options({ qos: 1, intervalMs: 10, count: 0 }),
      publish,
      onEvent: (event) => events.push(event),
      maxInFlight: () => cap
    })
    job.start()
    await vi.advanceTimersByTimeAsync(500)
    expect(publish).toHaveBeenCalledTimes(2)
    pending.shift()?.()
    await vi.advanceTimersByTimeAsync(10)
    expect(publish).toHaveBeenCalledTimes(3)
    // Read on every tick: a new CONNACK may announce another maximum.
    cap = 4
    await vi.advanceTimersByTimeAsync(100)
    expect(publish).toHaveBeenCalledTimes(5)
    // Never above MAX_IN_FLIGHT, never below one.
    cap = 0
    for (const resolve of pending.splice(0)) resolve()
    await vi.advanceTimersByTimeAsync(100)
    expect(publish).toHaveBeenCalledTimes(6)
    job.stop()
    expect(events.at(-1)?.state).toBe('stopped')
  })

  it('describes its first message before it starts', () => {
    const { job, publish } = setup(
      options({
        qos: 2,
        retain: true,
        properties: { topicAlias: 3 },
        payload: '{"n": {{counter}}}'
      })
    )
    const first = job.firstRequest()
    expect(first).toMatchObject({ topic: 'sensors/t', qos: 2, retain: true })
    expect(first.properties).toEqual({ topicAlias: 3 })
    expect(decoder.decode(first.payload)).toBe('{"n": 1}')
    expect(publish).not.toHaveBeenCalled()
  })

  it('throttles progress events while running', async () => {
    const { job, events } = setup(options({ intervalMs: 10, count: 0 }))
    job.start()
    await vi.advanceTimersByTimeAsync(1000)
    const running = events.filter((e) => e.state === 'running')
    expect(running.length).toBeGreaterThan(2)
    expect(running.length).toBeLessThanOrEqual(6)
    expect(running.at(-1)?.sent).toBeGreaterThan(90)
    job.stop()
  })

  it('does not burst after the event loop stalled', async () => {
    let stalledMs = 0
    const publish = vi.fn(() => Promise.resolve())
    const job = new RepeatJob({
      id: 'job-stall',
      connectionId: 'c1',
      options: options({ count: 0 }),
      publish,
      onEvent: () => {},
      // The monotonic clock jumps ahead as if the event loop had been blocked.
      clock: () => performance.now() + stalledMs
    })
    job.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(publish).toHaveBeenCalledTimes(1)
    stalledMs = 1000 // ten messages overdue: skipped, not sent in a burst
    await vi.advanceTimersByTimeAsync(100)
    expect(publish).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(publish).toHaveBeenCalledTimes(3)
    job.stop()
  })

  it('keeps its schedule when the wall clock jumps (monotonic clock)', async () => {
    const { job, publish } = setup(options({ count: 0 }))
    job.start()
    await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(Date.now() - 3_600_000) // the system clock goes back an hour
    await vi.advanceTimersByTimeAsync(100)
    expect(publish).toHaveBeenCalledTimes(2)
    vi.setSystemTime(Date.now() + 7_200_000)
    await vi.advanceTimersByTimeAsync(100)
    expect(publish).toHaveBeenCalledTimes(3)
    job.stop()
  })
})

describe('assertRepeatOptions', () => {
  it('accepts valid options', () => {
    expect(() => assertRepeatOptions(options())).not.toThrow()
  })

  it('rejects out-of-range intervals and counts', () => {
    expect(() => assertRepeatOptions(options({ intervalMs: 5 }))).toThrow(/Interval/)
    expect(() => assertRepeatOptions(options({ count: -1 }))).toThrow(/Count/)
    expect(() => assertRepeatOptions(options({ count: 1.5 }))).toThrow(/Count/)
  })

  it('rejects payloads that cannot be encoded', () => {
    expect(() => assertRepeatOptions(options({ payload: '{oops' }))).toThrow(/Invalid JSON/)
    expect(() => assertRepeatOptions(options({ payload: 'zz', format: 'hex' }))).toThrow(/hex/i)
  })

  it('checks the payload as authored when templates are off', () => {
    // Literal `{{counter}}` is not valid JSON: only rendering would make it valid.
    expect(() => assertRepeatOptions(options({ useTemplate: false }))).toThrow(/Invalid JSON/)
    expect(() =>
      assertRepeatOptions(options({ payload: 'n={{counter}}', format: 'text', useTemplate: false }))
    ).not.toThrow()
  })
})

describe('RepeatJob without templates', () => {
  it('sends literal template text on every tick when useTemplate is false', async () => {
    const { job, events, publish } = setup(
      options({ payload: 'value {{counter}} {{uuid}}', format: 'text', useTemplate: false })
    )
    job.start()
    await vi.advanceTimersByTimeAsync(250)
    expect(payloads(publish)).toEqual([
      'value {{counter}} {{uuid}}',
      'value {{counter}} {{uuid}}',
      'value {{counter}} {{uuid}}'
    ])
    expect(events.at(-1)).toMatchObject({ state: 'completed', sent: 3 })
  })

  it('renders templates when useTemplate is true or omitted', async () => {
    const { job, publish } = setup(options({ payload: 'n={{counter}}', format: 'text' }))
    job.start()
    await vi.advanceTimersByTimeAsync(250)
    expect(payloads(publish)).toEqual(['n=1', 'n=2', 'n=3'])
  })
})
