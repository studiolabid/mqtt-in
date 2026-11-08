import { describe, expect, it } from 'vitest'
import { MAX_RETAINED_BYTES, MessageBuffer } from '@/utils/message-buffer'
import { RateMeter } from '@/utils/rate-meter'
import { message, messages, utf8 } from './helpers'

const MIB = 1024 * 1024

describe('MessageBuffer', () => {
  it('appends in order and assigns sequence numbers', () => {
    const buffer = new MessageBuffer(10)
    const batch = messages(3)
    buffer.push(batch)
    expect(buffer.messages).toEqual(batch)
    expect(buffer.size).toBe(3)
    expect(buffer.evicted).toBe(0)
    expect(buffer.appended).toBe(3)
    expect(buffer.push([])).toEqual([])
  })

  it('counts messages and bytes per direction', () => {
    const buffer = new MessageBuffer(10)
    buffer.push([
      message({ payload: utf8('abc') }),
      message({ direction: 'out', payload: utf8('12345') }),
      message({ payload: new Uint8Array(0) })
    ])
    expect(buffer.stats).toMatchObject({
      received: 2,
      sent: 1,
      bytesIn: 3,
      bytesOut: 5,
      dropped: 0
    })
  })

  it('evicts the oldest messages in chunks of 5 % of the capacity', () => {
    const buffer = new MessageBuffer(100)
    const batch = messages(101)
    expect(buffer.push(batch)).toEqual(batch.slice(0, 6))
    expect(buffer.size).toBe(95)
    expect(buffer.messages[0]).toBe(batch[6])
    expect(buffer.evicted).toBe(6)
    expect(buffer.appended).toBe(101)
    // Counters include evicted messages.
    expect(buffer.stats).toMatchObject({ received: 101, dropped: 6 })
    // Under the capacity again: no eviction until it overflows.
    expect(buffer.push(messages(5))).toHaveLength(0)
    expect(buffer.size).toBe(100)
  })

  it('keeps only the newest messages of a batch larger than the capacity', () => {
    const buffer = new MessageBuffer(10)
    const batch = messages(25)
    buffer.push(batch)
    expect(buffer.size).toBe(10 - 1)
    expect(buffer.messages[buffer.size - 1]).toBe(batch[24])
    expect(buffer.stats.dropped).toBe(16)
  })

  it('shrinks immediately when the capacity is lowered', () => {
    const buffer = new MessageBuffer(50)
    const batch = messages(40)
    buffer.push(batch)
    expect(buffer.setCapacity(30)).toEqual(batch.slice(0, 10))
    expect(buffer.size).toBe(30)
    expect(buffer.messages[0]).toBe(batch[10])
    expect(buffer.setCapacity(100)).toHaveLength(0)
    expect(buffer.capacity).toBe(100)
    expect(new MessageBuffer(Number.NaN).capacity).toBe(1)
    expect(new MessageBuffer(-5).capacity).toBe(1)
  })

  it('clears messages and statistics and starts a new generation', () => {
    const buffer = new MessageBuffer(10)
    buffer.push(messages(3))
    const generation = buffer.generation
    buffer.clear()
    expect(buffer.size).toBe(0)
    expect(buffer.appended).toBe(0)
    expect(buffer.stats).toEqual({
      received: 0,
      sent: 0,
      bytesIn: 0,
      bytesOut: 0,
      inRate: 0,
      outRate: 0,
      dropped: 0,
      retainedBytes: 0
    })
    expect(buffer.generation).not.toBe(generation)
  })

  it('caps the payload bytes held: 1,000 pushes of 1 MB with a 64 MB budget', () => {
    const budget = 64 * MIB
    const buffer = new MessageBuffer(10_000, { maxBytes: budget })
    expect(buffer.byteBudget).toBe(budget)
    let evicted = 0
    for (let i = 0; i < 1_000; i++) {
      evicted += buffer.push([message({ payload: new Uint8Array(MIB) })]).length
      expect(buffer.size).toBeLessThanOrEqual(64)
      expect(buffer.retainedBytes).toBeLessThanOrEqual(budget)
      expect(buffer.retainedBytes).toBe(buffer.size * MIB)
    }
    const stats = buffer.stats
    expect(stats.retainedBytes).toBe(buffer.retainedBytes)
    // `dropped` counts byte evictions and stays consistent with the sequence numbers.
    expect(stats.dropped).toBe(evicted)
    expect(stats.dropped).toBe(buffer.evicted)
    expect(stats.dropped + buffer.size).toBe(1_000)
    expect(stats.received).toBe(1_000)
    expect(stats.bytesIn).toBe(1_000 * MIB)
  })

  it('evicts by bytes in chunks and always keeps the newest message', () => {
    const buffer = new MessageBuffer(1_000, { maxBytes: 100 })
    const small = messages(10, { payload: new Uint8Array(10) })
    expect(buffer.push(small)).toHaveLength(0)
    expect(buffer.retainedBytes).toBe(100)
    // 10 bytes over the budget: evicted down to 95 % of it (2 messages), not one by one.
    const next = message({ payload: new Uint8Array(10) })
    expect(buffer.push([next])).toEqual(small.slice(0, 2))
    expect(buffer.retainedBytes).toBe(90)
    // A single message larger than the whole budget stays (alone).
    const huge = message({ payload: new Uint8Array(500) })
    buffer.push([huge])
    expect(buffer.messages).toEqual([huge])
    expect(buffer.retainedBytes).toBe(500)
    buffer.clear()
    expect(buffer.retainedBytes).toBe(0)
    expect(new MessageBuffer(10).byteBudget).toBe(MAX_RETAINED_BYTES)
  })

  it('counts retained bytes of both directions and releases them on eviction', () => {
    const buffer = new MessageBuffer(2)
    buffer.push([
      message({ payload: utf8('abc') }),
      message({ direction: 'out', payload: utf8('de') })
    ])
    expect(buffer.retainedBytes).toBe(5)
    const evicted = buffer.push([message({ payload: utf8('f') })])
    expect(evicted.map((m) => m.payload.byteLength)).toEqual([3, 2])
    expect(buffer.retainedBytes).toBe(1)
    expect(buffer.stats).toMatchObject({ bytesIn: 4, bytesOut: 2, retainedBytes: 1, dropped: 2 })
  })

  it('gives every buffer a distinct generation', () => {
    expect(new MessageBuffer(1).generation).not.toBe(new MessageBuffer(1).generation)
  })

  it('finds messages by id with ordered and unordered ids', () => {
    const buffer = new MessageBuffer(1000)
    const batch = messages(500)
    buffer.push(batch)
    expect(buffer.findById(batch[123].id)).toBe(batch[123])
    expect(buffer.findById(-1)).toBeUndefined()

    const unordered = new MessageBuffer(10)
    const late = message({ id: 5 })
    const early = message({ id: 1 })
    unordered.push([message({ id: 10 }), late, early])
    expect(unordered.findById(1)).toBe(early)
    expect(unordered.findById(5)).toBe(late)
    expect(unordered.findById(7)).toBeUndefined()
  })

  it('computes msg/s rates over a sliding window that decays to zero', () => {
    const buffer = new MessageBuffer(10_000)
    buffer.push(messages(100))
    buffer.push(messages(20, { direction: 'out' }))
    expect(buffer.ratesActive).toBe(true)
    expect(buffer.tick(1_000)).toBe(true)
    expect(buffer.stats.inRate).toBe(100)
    expect(buffer.stats.outRate).toBe(20)

    // Quiet seconds: the average decays over the 5 s window.
    buffer.tick(2_000)
    expect(buffer.stats.inRate).toBe(50)
    buffer.tick(3_000)
    buffer.tick(4_000)
    buffer.tick(5_000)
    expect(buffer.stats.inRate).toBe(20)
    expect(buffer.tick(6_000)).toBe(false)
    expect(buffer.stats.inRate).toBe(0)
    expect(buffer.stats.outRate).toBe(0)
    expect(buffer.ratesActive).toBe(false)
  })
})

describe('RateMeter', () => {
  it('weights samples by the real time between ticks', () => {
    const meter = new RateMeter()
    meter.record(10)
    meter.tick(10_000) // first sample: nominal 1 s
    expect(meter.rate).toBe(10)
    meter.record(10)
    meter.tick(12_000) // 2 s later (late timer)
    expect(meter.rate).toBeCloseTo(20 / 3, 6)
  })

  it('is idle without records and ignores non-positive counts', () => {
    const meter = new RateMeter()
    meter.record(0)
    meter.record(-3)
    expect(meter.active).toBe(false)
    expect(meter.tick(1)).toBe(false)
    expect(meter.rate).toBe(0)
  })

  it('restarts with a nominal first sample after going idle', () => {
    const meter = new RateMeter(2)
    meter.record(4)
    meter.tick(0)
    meter.tick(1_000)
    expect(meter.tick(2_000)).toBe(false)
    meter.record(6)
    meter.tick(60_000)
    expect(meter.rate).toBe(6)
  })

  it('resets', () => {
    const meter = new RateMeter()
    meter.record(5)
    meter.tick(1)
    meter.reset()
    expect(meter.rate).toBe(0)
    expect(meter.active).toBe(false)
  })
})
