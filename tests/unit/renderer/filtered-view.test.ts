import { describe, expect, it } from 'vitest'
import type { MqttMessage } from '@shared/models'
import { FilteredView } from '@/utils/filtered-view'
import { MessageBuffer, type MessageSource } from '@/utils/message-buffer'
import { message, messages } from './helpers'

function onTopic(topic: string): (m: MqttMessage) => boolean {
  return (m) => m.topic === topic
}

function snapshotOf(buffer: MessageBuffer): MessageSource {
  return {
    messages: buffer.messages.slice(),
    evicted: buffer.evicted,
    appended: buffer.appended,
    generation: buffer.generation
  }
}

describe('FilteredView', () => {
  it('mirrors the buffer without a predicate and keeps its identity when unchanged', () => {
    const buffer = new MessageBuffer(100)
    const view = new FilteredView()
    const batch = messages(3)
    buffer.push(batch)
    expect(view.sync(buffer)).toBe(true)
    expect(view.rows).toEqual(batch)
    const rows = view.rows
    expect(view.sync(buffer)).toBe(false)
    expect(view.rows).toBe(rows)
  })

  it('reports no change for an empty buffer', () => {
    const view = new FilteredView()
    expect(view.sync(new MessageBuffer(10))).toBe(false)
    expect(view.rows).toEqual([])
  })

  it('tests only new messages and appends matches (new array identity)', () => {
    const buffer = new MessageBuffer(100)
    let calls = 0
    const view = new FilteredView((m) => {
      calls++
      return m.topic === 'a'
    })
    buffer.push([message({ topic: 'a' }), message({ topic: 'b' })])
    view.sync(buffer)
    expect(calls).toBe(2)
    const before = view.rows

    const next = message({ topic: 'a' })
    buffer.push([message({ topic: 'b' }), next])
    expect(view.sync(buffer)).toBe(true)
    expect(calls).toBe(4)
    expect(view.rows).not.toBe(before)
    expect(view.rows.map((m) => m.topic)).toEqual(['a', 'a'])
    expect(view.rows[1]).toBe(next)

    buffer.push([message({ topic: 'b' })])
    expect(view.sync(buffer)).toBe(false)
  })

  it('drops evicted rows from the head', () => {
    const buffer = new MessageBuffer(20)
    const view = new FilteredView(onTopic('keep'))
    const first = message({ topic: 'keep' })
    buffer.push([first, ...messages(5, { topic: 'other' })])
    view.sync(buffer)
    expect(view.rows).toEqual([first])

    // 21 messages in a capacity of 20 → 2 evicted (chunk of 1 + overflow of 1).
    buffer.push(messages(15, { topic: 'other' }))
    expect(buffer.evicted).toBe(2)
    expect(view.sync(buffer)).toBe(true)
    expect(view.rows).toEqual([])
  })

  it('keeps only the newest rows with maxRows', () => {
    const buffer = new MessageBuffer(100)
    const view = new FilteredView(null, { maxRows: 3 })
    const batch = messages(5)
    buffer.push(batch)
    view.sync(buffer)
    expect(view.rows).toEqual(batch.slice(2))
    expect(view.limit).toBe(3)

    const more = messages(2)
    buffer.push(more)
    view.sync(buffer)
    expect(view.rows).toEqual([batch[4], ...more])
  })

  it('rebuilds after a predicate change, a clear or a reset', () => {
    const buffer = new MessageBuffer(100)
    const a = message({ topic: 'a' })
    const b = message({ topic: 'b' })
    buffer.push([a, b])
    const view = new FilteredView(onTopic('a'))
    view.sync(buffer)
    expect(view.rows).toEqual([a])

    view.setPredicate(onTopic('b'))
    expect(view.sync(buffer)).toBe(true)
    expect(view.rows).toEqual([b])

    buffer.clear()
    expect(view.sync(buffer)).toBe(true)
    expect(view.rows).toEqual([])

    const c = message({ topic: 'b' })
    buffer.push([c])
    view.reset()
    expect(view.rows).toEqual([])
    expect(view.sync(buffer)).toBe(true)
    expect(view.rows).toEqual([c])
  })

  it('switches between a frozen snapshot and the live buffer incrementally', () => {
    const buffer = new MessageBuffer(1000)
    const view = new FilteredView()
    const before = messages(3)
    buffer.push(before)
    view.sync(buffer)

    const frozen = snapshotOf(buffer)
    const during = messages(4)
    buffer.push(during) // arrives while paused
    expect(view.sync(frozen)).toBe(false)
    expect(view.rows).toEqual(before)

    expect(view.sync(buffer)).toBe(true) // resumed
    expect(view.rows).toEqual([...before, ...during])
  })

  it('rebuilds when synced against another buffer', () => {
    const one = new MessageBuffer(10)
    const two = new MessageBuffer(10)
    one.push(messages(2))
    const other = messages(1)
    two.push(other)
    const view = new FilteredView()
    view.sync(one)
    expect(view.sync(two)).toBe(true)
    expect(view.rows).toEqual(other)
  })
})

/** A clock that advances only while the predicate runs: `cost` ms per tested message. */
function costlyPredicate(
  cost: number,
  match: (m: MqttMessage) => boolean
): { now: () => number; predicate: (m: MqttMessage) => boolean } {
  let time = 0
  return {
    now: () => time,
    predicate: (m) => {
      time += cost
      return match(m)
    }
  }
}

function everyThird(m: MqttMessage): boolean {
  return m.id % 3 === 0
}

describe('FilteredView time-sliced rebuild (PERF-01)', () => {
  it.each([0.5, 0.3, 0.07])(
    'never spends more than the budget per slice (%s ms per message) and ends with the synchronous rows',
    (cost) => {
      const buffer = new MessageBuffer(5000)
      buffer.push(messages(3000))
      const clock = costlyPredicate(cost, everyThird)
      const view = new FilteredView(clock.predicate, { now: clock.now })
      const slices: number[] = []
      let first: readonly MqttMessage[] | null = null
      while (view.pending) {
        const start = clock.now()
        view.sync(buffer, { budgetMs: 8 })
        slices.push(clock.now() - start)
        first ??= view.rows
        expect(slices.length).toBeLessThan(10_000)
      }
      const reference = new FilteredView(everyThird)
      reference.sync(buffer)

      expect(slices.length).toBeGreaterThan(1)
      expect(Math.max(...slices)).toBeLessThanOrEqual(8 + 1e-9)
      expect(view.rows).toEqual(reference.rows)
      // The newest matches come first: the first slice is the tail of the final rows.
      expect(first?.length).toBeGreaterThan(0)
      expect(reference.rows.slice(-(first?.length ?? 0))).toEqual(first)
    }
  )

  it('finishes in one sync without a budget, and with a clock that does not move', () => {
    const buffer = new MessageBuffer(1000)
    buffer.push(messages(900))
    const unbounded = new FilteredView(costlyPredicate(1, everyThird).predicate)
    unbounded.sync(buffer)
    expect(unbounded.pending).toBe(false)
    const frozen = new FilteredView(everyThird, { now: () => 0 })
    frozen.sync(buffer, { budgetMs: 8 })
    expect(frozen.pending).toBe(false)
    expect(frozen.rows).toEqual(unbounded.rows)
  })

  it('tests at least one older message per slice, even over budget', () => {
    const buffer = new MessageBuffer(10)
    buffer.push(messages(4))
    const clock = costlyPredicate(50, () => true)
    const view = new FilteredView(clock.predicate, { now: clock.now })
    let syncs = 0
    while (view.pending && syncs < 10) {
      view.sync(buffer, { budgetMs: 8 })
      syncs++
    }
    expect(syncs).toBe(4)
    expect(view.rows).toEqual(buffer.messages)
  })

  it('goes on across new messages and head eviction', () => {
    const buffer = new MessageBuffer(400)
    buffer.push(messages(400))
    const clock = costlyPredicate(1, everyThird)
    const view = new FilteredView(clock.predicate, { now: clock.now })
    view.sync(buffer, { budgetMs: 8 })
    expect(view.pending).toBe(true)
    let rounds = 0
    while (view.pending) {
      buffer.push(messages(30)) // evicts from the head while the pass runs
      view.sync(buffer, { budgetMs: 8 })
      expect(++rounds).toBeLessThan(1000)
    }
    const reference = new FilteredView(everyThird)
    reference.sync(buffer)
    expect(view.rows).toEqual(reference.rows)
  })

  it('drops an unfinished pass when the predicate changes', () => {
    const buffer = new MessageBuffer(1000)
    buffer.push(messages(600))
    const odd = costlyPredicate(1, (m) => m.id % 2 === 1)
    const view = new FilteredView(odd.predicate, { now: odd.now })
    view.sync(buffer, { budgetMs: 8 })
    expect(view.pending).toBe(true)

    view.setPredicate(everyThird)
    expect(view.pending).toBe(true)
    view.sync(buffer, { budgetMs: 8 })
    expect(view.pending).toBe(false)
    expect(view.rows.every(everyThird)).toBe(true)
    expect(view.rows).toHaveLength(buffer.messages.filter(everyThird).length)
  })

  it('stops a limited view at the newest matches', () => {
    const buffer = new MessageBuffer(1000)
    buffer.push(messages(900))
    let tested = 0
    const view = new FilteredView(
      (m) => {
        tested++
        return everyThird(m)
      },
      { maxRows: 5, now: () => 0 }
    )
    view.sync(buffer, { budgetMs: 8 })
    expect(view.pending).toBe(false)
    expect(view.rows).toEqual(buffer.messages.filter(everyThird).slice(-5))
    expect(tested).toBeLessThanOrEqual(15)
  })
})
