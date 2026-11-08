import { describe, expect, it } from 'vitest'
import { createSubscription } from '@shared/defaults'
import { KeyedQueue } from '@/utils/keyed-queue'
import {
  assertUniqueFilter,
  liveFieldsChanged,
  MAX_SUBSCRIPTION_IDENTIFIER,
  prepareSubscription
} from '@/utils/subscription'

describe('prepareSubscription', () => {
  it('trims the filter and fills missing fields', () => {
    const sub = prepareSubscription({ topic: '  a/+/c ' } as never)
    expect(sub.topic).toBe('a/+/c')
    expect(sub.id).toMatch(/[0-9a-f-]{36}/)
    expect(sub).toMatchObject({ qos: 0, enabled: true, retainHandling: 0 })
  })

  it.each([
    [{ topic: '' }, 'Topic filter is required'],
    [{ topic: 'a#' }, "'#' must be the last level and occupy the whole level"],
    [{ topic: 'a', qos: 3 }, 'QoS must be 0, 1 or 2'],
    [{ topic: 'a', subscriptionIdentifier: 1.5 }, /Subscription identifier/],
    [{ topic: 'a', subscriptionIdentifier: MAX_SUBSCRIPTION_IDENTIFIER + 1 }, /between 1 and/]
  ])('rejects %j', (input, message) => {
    expect(() => prepareSubscription(createSubscription(input as never))).toThrow(message)
  })

  it('accepts the identifier range', () => {
    const max = { topic: 'a', subscriptionIdentifier: MAX_SUBSCRIPTION_IDENTIFIER }
    expect(prepareSubscription(createSubscription(max)).subscriptionIdentifier).toBe(
      MAX_SUBSCRIPTION_IDENTIFIER
    )
  })
})

describe('assertUniqueFilter / liveFieldsChanged', () => {
  const a = createSubscription({ topic: 'a' })

  it('rejects another subscription with the same filter', () => {
    expect(() => assertUniqueFilter([a], createSubscription({ topic: 'a' }))).toThrow(
      'A subscription for "a" already exists'
    )
    expect(() => assertUniqueFilter([a], { ...a })).not.toThrow()
    expect(() => assertUniqueFilter([a], createSubscription({ topic: 'A' }))).not.toThrow()
  })

  it('detects changes that need a re-subscribe', () => {
    expect(liveFieldsChanged(a, { ...a, alias: 'x', color: '#000000' })).toBe(false)
    expect(liveFieldsChanged(a, { ...a, qos: 1 })).toBe(true)
    expect(liveFieldsChanged(a, { ...a, enabled: false })).toBe(true)
    expect(liveFieldsChanged(a, { ...a, noLocal: true })).toBe(true)
    expect(liveFieldsChanged(a, { ...a, subscriptionIdentifier: 4 })).toBe(true)
  })
})

describe('KeyedQueue', () => {
  it('runs tasks of one key in order and other keys concurrently', async () => {
    const queue = new KeyedQueue()
    const order: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))

    const first = queue.run('a', async () => {
      await gate
      order.push('a1')
      return 1
    })
    const second = queue.run('a', async () => {
      order.push('a2')
      return 2
    })
    const other = queue.run('b', async () => {
      order.push('b1')
      return 3
    })
    await other
    expect(order).toEqual(['b1'])
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2])
    expect(order).toEqual(['b1', 'a1', 'a2'])
    await Promise.resolve()
    expect(queue.size).toBe(0)
  })

  it('keeps going after a failing task', async () => {
    const queue = new KeyedQueue()
    const failing = queue.run('a', async () => {
      throw new Error('boom')
    })
    const next = queue.run('a', async () => 'ok')
    await expect(failing).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
  })
})
