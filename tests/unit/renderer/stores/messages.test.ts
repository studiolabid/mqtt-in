import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isReactive, nextTick, reactive } from 'vue'
import { useMessagesStore } from '@/stores/messages'
import { useSettingsStore } from '@/stores/settings'
import { message, messages, utf8 } from '../helpers'
import { setupStores } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

describe('useMessagesStore', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    await setupStores()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stores batches per connection and bumps each revision once per batch', () => {
    const store = useMessagesStore()
    expect(store.revision('a')).toBe(0)
    const batch = [
      message({ connectionId: 'a', topic: 'x' }),
      message({ connectionId: 'b', topic: 'y' }),
      message({ connectionId: 'a', topic: 'z' })
    ]
    store.ingest(batch)
    expect(store.revision('a')).toBe(1)
    expect(store.revision('b')).toBe(1)
    expect(store.messages('a').map((m) => m.topic)).toEqual(['x', 'z'])
    expect(store.count('b')).toBe(1)
    store.ingest(messages(3, { connectionId: 'a' }))
    expect(store.revision('a')).toBe(2)
    expect(store.revision('b')).toBe(1)
    store.ingest([])
    expect(store.revision('a')).toBe(2)
  })

  it('returns message snapshots whose identity changes once per revision', () => {
    const store = useMessagesStore()
    store.ingest(messages(2, { connectionId: 'a' }))
    const first = store.messages('a')
    expect(store.messages('a')).toBe(first)
    store.ingest(messages(1, { connectionId: 'a' }))
    const second = store.messages('a')
    expect(second).not.toBe(first)
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(3)
    store.clear('a')
    expect(store.messages('a')).toEqual([])
  })

  it('exposes topic nodes as snapshots', () => {
    const store = useMessagesStore()
    expect(store.topicNode('a', 'x')).toBeUndefined()
    const last = message({ connectionId: 'a', topic: 'x/y', retain: true, timestamp: 7 })
    store.ingest([message({ connectionId: 'a', topic: 'x/z' }), last])
    const node = store.topicNode('a', 'x')
    expect(node).toEqual({
      name: 'x',
      topic: 'x',
      depth: 0,
      messageCount: 0,
      totalMessages: 2,
      topicCount: 2,
      lastMessage: undefined,
      lastPayloadBytes: 0,
      retained: false,
      updatedAt: expect.any(Number),
      childCount: 2
    })
    expect(store.topicNode('a', 'x/y')).toMatchObject({ lastMessage: last, retained: true })
    expect(store.topicNode('a', 'x')).not.toBe(node)
  })

  it('keeps messages out of Vue reactivity', () => {
    const store = useMessagesStore()
    const m = message()
    store.ingest([m])
    expect(isReactive(reactive({ m }).m)).toBe(false)
  })

  it('maintains the topic tree and statistics', () => {
    const store = useMessagesStore()
    store.ingest([
      message({ connectionId: 'a', topic: 'h/1', payload: utf8('abc') }),
      message({ connectionId: 'a', topic: 'h/2', direction: 'out', payload: utf8('12') })
    ])
    expect(store.topicTree('a').get('h/1')?.messageCount).toBe(1)
    expect(store.topicTree('a').get('h/2')).toBeUndefined()
    expect(store.stats('a')).toMatchObject({ received: 1, sent: 1, bytesIn: 3, bytesOut: 2 })
    expect(store.stats('none')).toMatchObject({ received: 0, inRate: 0 })
  })

  it('uses the capacity setting and applies changes to it', async () => {
    const settings = useSettingsStore()
    const store = useMessagesStore()
    await settings.update({ maxMessagesPerConnection: 100 })
    store.ingest(messages(100, { connectionId: 'a' }))
    expect(store.count('a')).toBe(100)
    store.ingest(messages(1, { connectionId: 'a' }))
    expect(store.count('a')).toBe(95)
    expect(store.stats('a').dropped).toBe(6)

    const revision = store.revision('a')
    store.ingest(messages(200, { connectionId: 'b' }))
    await settings.update({ maxMessagesPerConnection: 150 })
    await nextTick()
    expect(store.count('a')).toBe(95)
    expect(store.revision('a')).toBe(revision)
    store.ingest(messages(50, { connectionId: 'b' }))
    expect(store.count('b')).toBe(145)
    await settings.update({ maxMessagesPerConnection: 120 })
    await nextTick()
    expect(store.count('b')).toBe(120)
    expect(store.stats('b').dropped).toBe(105 + 25)
  })

  it('finds messages by id', () => {
    const store = useMessagesStore()
    const batch = messages(10, { connectionId: 'a' })
    store.ingest(batch)
    expect(store.findById('a', batch[3].id)).toBe(batch[3])
    expect(store.findById('a', -1)).toBeUndefined()
    expect(store.findById('nothing', batch[3].id)).toBeUndefined()
  })

  it('returns a cached, incrementally updated topic history', () => {
    const store = useMessagesStore()
    const first = message({ connectionId: 'a', topic: 't' })
    store.ingest([first, message({ connectionId: 'a', topic: 'other' })])
    const history = store.topicHistory('a', 't')
    expect(history).toEqual([first])
    expect(store.topicHistory('a', 't')).toBe(history)

    store.ingest([message({ connectionId: 'a', topic: 'other' })])
    expect(store.topicHistory('a', 't')).toBe(history)

    const second = message({ connectionId: 'a', topic: 't' })
    const third = message({ connectionId: 'a', topic: 't' })
    store.ingest([second, third])
    expect(store.topicHistory('a', 't')).toEqual([first, second, third])
    expect(store.topicHistory('a', 't', 2)).toEqual([second, third])
  })

  it('keeps one topic history view per limit (callers with different limits share nothing)', () => {
    const store = useMessagesStore()
    store.ingest(messages(3, { connectionId: 'a', topic: 't' }))
    const short = store.topicHistory('a', 't', 2)
    const long = store.topicHistory('a', 't', 2000)
    expect(short).toHaveLength(2)
    expect(long).toHaveLength(3)
    // Reading them alternately returns the cached arrays: no rebuild over the whole buffer.
    expect(store.topicHistory('a', 't', 2)).toBe(short)
    expect(store.topicHistory('a', 't', 2000)).toBe(long)
  })

  it('clears messages, topics and statistics', () => {
    const store = useMessagesStore()
    store.ingest(messages(5, { connectionId: 'a', topic: 'q' }))
    const revision = store.revision('a')
    store.clear('a')
    expect(store.count('a')).toBe(0)
    expect(store.topicTree('a').topicCount).toBe(0)
    expect(store.topicHistory('a', 'q')).toEqual([])
    expect(store.stats('a').received).toBe(0)
    expect(store.revision('a')).toBe(revision + 1)
  })

  it('forgets a connection', () => {
    const store = useMessagesStore()
    store.ingest(messages(2, { connectionId: 'a' }))
    store.setPaused('a', true)
    store.forget('a')
    expect(store.count('a')).toBe(0)
    expect(store.isPaused('a')).toBe(false)
  })

  it('pauses views per connection', () => {
    const store = useMessagesStore()
    expect(store.isPaused('a')).toBe(false)
    store.setPaused('a', true)
    expect(store.isPaused('a')).toBe(true)
    expect(store.isPaused('b')).toBe(false)
    store.togglePaused('a')
    expect(store.isPaused('a')).toBe(false)
    // Ingestion continues while paused.
    store.setPaused('a', true)
    store.ingest(messages(2, { connectionId: 'a' }))
    expect(store.count('a')).toBe(2)
  })

  it('computes rates with a timer that stops once traffic is over', async () => {
    const store = useMessagesStore()
    store.ingest(messages(50, { connectionId: 'a' }))
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.stats('a').inRate).toBe(50)
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.stats('a').inRate).toBe(25)
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.stats('a').inRate).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    // Traffic restarts the timer.
    store.ingest(messages(1, { connectionId: 'a' }))
    expect(vi.getTimerCount()).toBe(1)
  })
})
