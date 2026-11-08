import { describe, expect, it } from 'vitest'
import { DEFAULT_RECEIVE_MAXIMUM, SendQuota } from '../../../src/main/services/mqtt/send-quota'

function opened(receiveMaximum?: number, inUse = 0): SendQuota {
  const quota = new SendQuota()
  quota.open(receiveMaximum, inUse)
  return quota
}

describe('SendQuota', () => {
  it('starts at once while slots are free, then queues in FIFO order', () => {
    const quota = opened(2)
    const started: string[] = []
    for (const name of ['a', 'b', 'c', 'd']) quota.acquire(() => started.push(name))
    expect(started).toEqual(['a', 'b'])
    expect(quota.queued).toBe(2)
    quota.release()
    expect(started).toEqual(['a', 'b', 'c'])
    quota.release()
    quota.release()
    expect(started).toEqual(['a', 'b', 'c', 'd'])
    expect(quota.queued).toBe(0)
  })

  it('never lets a newcomer overtake a queued publish', () => {
    const quota = opened(1)
    const started: string[] = []
    quota.acquire(() => started.push('a'))
    quota.acquire(() => started.push('b'))
    quota.release() // b starts
    quota.acquire(() => started.push('c')) // the slot is b's: c waits
    expect(started).toEqual(['a', 'b'])
    quota.release()
    expect(started).toEqual(['a', 'b', 'c'])
  })

  it('cancels a queued start', () => {
    const quota = opened(1)
    const started: string[] = []
    quota.acquire(() => started.push('a'))
    const cancel = quota.acquire(() => started.push('b'))
    quota.acquire(() => started.push('c'))
    cancel()
    quota.release()
    expect(started).toEqual(['a', 'c'])
  })

  it('starts nothing while closed and resumes on the next CONNACK', () => {
    const quota = new SendQuota()
    const started: string[] = []
    quota.acquire(() => started.push('before connack'))
    expect(started).toEqual([])
    quota.open(5, 0)
    expect(started).toEqual(['before connack'])
    quota.close()
    quota.release()
    quota.acquire(() => started.push('while closed'))
    expect(started).toEqual(['before connack'])
    // The new connection may announce a smaller maximum; unacknowledged publishes count.
    quota.open(2, 2)
    expect(started).toEqual(['before connack'])
    quota.release()
    expect(started).toEqual(['before connack', 'while closed'])
  })

  it('defaults to 65,535 and ignores invalid announcements', () => {
    expect(opened().limit).toBe(DEFAULT_RECEIVE_MAXIMUM)
    expect(opened(0).limit).toBe(DEFAULT_RECEIVE_MAXIMUM)
    expect(opened(2.5).limit).toBe(DEFAULT_RECEIVE_MAXIMUM)
    expect(opened(10).limit).toBe(10)
  })

  it('copes with publishes that settle while they start (no recursion, no over-use)', () => {
    const quota = opened(1)
    let inFlight = 0
    let peak = 0
    let done = 0
    const start = (): void => {
      inFlight++
      peak = Math.max(peak, inFlight)
      // Settles synchronously, like a scripted client: releases its slot inside start().
      inFlight--
      done++
      quota.release()
    }
    quota.acquire(() => {}) // holds the slot
    for (let i = 0; i < 10_000; i++) quota.acquire(start)
    quota.release()
    expect(done).toBe(10_000)
    expect(peak).toBe(1)
    expect(quota.queued).toBe(0)
  })
})
