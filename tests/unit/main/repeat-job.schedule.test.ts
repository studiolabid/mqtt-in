import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishRequest, RepeatJobEvent, RepeatPublishOptions } from '@shared/models'
import { MAX_BURST, RepeatJob } from '../../../src/main/services/mqtt/repeat-job'

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

interface Harness {
  job: RepeatJob
  events: RepeatJobEvent[]
  publish: ReturnType<typeof vi.fn>
}

function setup(
  opts: RepeatPublishOptions,
  publish: (request: PublishRequest) => Promise<void> = () => Promise.resolve()
): Harness {
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

const payloads = (publish: ReturnType<typeof vi.fn>): string[] =>
  publish.mock.calls.map(([request]) => decoder.decode((request as PublishRequest).payload))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('RepeatJob while the session reconnects (MQ-14)', () => {
  it('sends nothing while paused (still running) and restarts the schedule on resume', async () => {
    const { job, events, publish } = setup(options({ count: 0 }))
    job.start()
    await vi.advanceTimersByTimeAsync(150) // t = 0 and 100
    expect(publish).toHaveBeenCalledTimes(2)
    job.pause()
    await vi.advanceTimersByTimeAsync(1000)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(events.at(-1)?.state).toBe('running')
    expect(job.running).toBe(true)
    job.resume() // the last message is long ago: the next one goes out now
    await vi.advanceTimersByTimeAsync(0)
    expect(publish).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(100)
    expect(publish).toHaveBeenCalledTimes(4)
    job.stop()
  })

  it('keeps at least one interval after the last message when resumed early', async () => {
    const { job, publish } = setup(options({ count: 0, intervalMs: 1000 }))
    job.start()
    await vi.advanceTimersByTimeAsync(200)
    job.pause()
    await vi.advanceTimersByTimeAsync(100)
    job.resume() // 300 ms after the first message
    await vi.advanceTimersByTimeAsync(699)
    expect(publish).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(publish).toHaveBeenCalledTimes(2)
    job.stop()
  })

  it('sends a message lost with the connection again (same counter), not as an error', async () => {
    const settle: Array<(err?: Error) => void> = []
    const { job, events, publish } = setup(
      options({ count: 3 }),
      () =>
        new Promise<void>((resolve, reject) =>
          settle.push((err) => (err ? reject(err) : resolve()))
        )
    )
    job.start()
    await vi.advanceTimersByTimeAsync(0)
    settle.shift()?.() // #1 sent
    await vi.advanceTimersByTimeAsync(100) // #2 handed over…
    job.pause()
    settle.shift()?.(new Error('Connection lost')) // …and lost with the connection
    await vi.advanceTimersByTimeAsync(500)
    expect(events.at(-1)).toMatchObject({ state: 'running', sent: 1 })
    job.resume()
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(100)
      settle.shift()?.()
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(payloads(publish)).toEqual(['{"n": 1}', '{"n": 2}', '{"n": 2}', '{"n": 3}'])
    expect(events.at(-1)).toMatchObject({ state: 'completed', sent: 3 })
    expect(events.some((e) => e.state === 'error')).toBe(false)
  })

  it('still fails on a refusal while connected, and stops while paused', async () => {
    const failing = setup(options({ count: 0 }), () => Promise.reject(new Error('Not authorized')))
    failing.job.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(failing.events.at(-1)).toMatchObject({ state: 'error', error: 'Not authorized' })

    const paused = setup(options({ count: 0 }))
    paused.job.start()
    await vi.advanceTimersByTimeAsync(0)
    paused.job.pause()
    paused.job.stop()
    paused.job.resume() // no-op once finished
    await vi.advanceTimersByTimeAsync(500)
    expect(paused.events.at(-1)?.state).toBe('stopped')
    expect(paused.publish).toHaveBeenCalledTimes(1)
  })
})

describe('RepeatJob intervals below the timer granularity (MQ-20)', () => {
  /** Timers that fire on a 15.625 ms grid, like the Windows default timer resolution. */
  function coarseTimers(): void {
    const grain = 15.625
    const fakeSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, ms?: number) => {
      const now = Date.now()
      const at = Math.ceil((now + (ms ?? 0)) / grain) * grain
      return fakeSetTimeout(callback, Math.ceil(at - now))
    }) as typeof setTimeout)
  }

  it('sends a 10 ms × 300 job in ~3 s, at most MAX_BURST messages per timer callback', async () => {
    coarseTimers()
    const startedAt = Date.now()
    const sentAt: number[] = []
    const { job, events } = setup(options({ intervalMs: 10, count: 300 }), () => {
      sentAt.push(Date.now() - startedAt)
      return Promise.resolve()
    })
    job.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(events.at(-1)).toMatchObject({ state: 'completed', sent: 300 })
    // One message per callback (the old behaviour) would take 300 × 15.6 ms ≈ 4.7 s.
    const last = sentAt.at(-1) ?? 0
    expect(last).toBeGreaterThanOrEqual(2700)
    expect(last).toBeLessThanOrEqual(3300)
    const perCallback = new Map<number, number>()
    for (const at of sentAt) perCallback.set(at, (perCallback.get(at) ?? 0) + 1)
    expect(Math.max(...perCallback.values())).toBeLessThanOrEqual(MAX_BURST)
    expect(Math.max(...perCallback.values())).toBeGreaterThan(1) // it did catch up
  })

  it('respects the in-flight cap while catching up', async () => {
    coarseTimers()
    const pending: Array<() => void> = []
    const events: RepeatJobEvent[] = []
    const publish = vi.fn(() => new Promise<void>((resolve) => pending.push(resolve)))
    const job = new RepeatJob({
      id: 'job-cap',
      connectionId: 'c1',
      options: options({ intervalMs: 10, count: 0, qos: 1 }),
      publish,
      onEvent: (event) => events.push(event),
      maxInFlight: () => 2
    })
    job.start()
    await vi.advanceTimersByTimeAsync(200)
    expect(publish).toHaveBeenCalledTimes(2)
    job.stop()
  })
})
