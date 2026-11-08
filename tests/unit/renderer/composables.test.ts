import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref, type EffectScope } from 'vue'
import { useFormatters } from '@/composables/useFormatters'
import { useMessageList } from '@/composables/useMessageList'
import { previewOf } from '@/composables/usePayloadPreview'
import { useTopicTreeRows } from '@/composables/useTopicTreeRows'
import { useMessagesStore } from '@/stores/messages'
import { useSettingsStore } from '@/stores/settings'
import { DEFAULT_MESSAGE_FILTER, type MessageFilter } from '@/types'
import { message, messages, utf8 } from './helpers'
import { setupStores } from './stores/setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

let scope: EffectScope

function inScope<T>(factory: () => T): T {
  const result = scope.run(factory)
  if (result === undefined) throw new Error('effect scope is not active')
  return result
}

beforeEach(async () => {
  vi.useFakeTimers()
  await setupStores()
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useMessageList', () => {
  it('shows the buffer in chronological order and follows new batches (throttled)', async () => {
    const store = useMessagesStore()
    const first = messages(3, { connectionId: 'a' })
    store.ingest(first)
    const list = inScope(() => useMessageList('a', { ...DEFAULT_MESSAGE_FILTER }))
    expect(list.rows.value).toEqual(first)
    expect(list.total.value).toBe(3)
    expect(list.matched.value).toBe(3)

    const second = messages(2, { connectionId: 'a' })
    store.ingest(second)
    await nextTick() // leading edge: the watcher runs right away
    expect(list.rows.value).toEqual([...first, ...second])

    const third = messages(1, { connectionId: 'a' })
    store.ingest(third)
    await nextTick()
    expect(list.rows.value).toHaveLength(5) // throttled
    expect(list.total.value).toBe(6) // the total is live
    await vi.advanceTimersByTimeAsync(100)
    expect(list.rows.value).toHaveLength(6)
  })

  it('filters incrementally and re-filters when the filter changes', async () => {
    const store = useMessagesStore()
    store.ingest([
      message({ connectionId: 'a', topic: 'home/1' }),
      message({ connectionId: 'a', topic: 'office/1' })
    ])
    const filter = reactive<MessageFilter>({ ...DEFAULT_MESSAGE_FILTER, topic: 'home/#' })
    const list = inScope(() => useMessageList('a', filter))
    expect(list.rows.value.map((m) => m.topic)).toEqual(['home/1'])

    store.ingest([message({ connectionId: 'a', topic: 'home/2' })])
    await vi.advanceTimersByTimeAsync(100)
    expect(list.rows.value.map((m) => m.topic)).toEqual(['home/1', 'home/2'])

    filter.topic = 'office'
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)
    expect(list.rows.value.map((m) => m.topic)).toEqual(['office/1'])
    expect(list.total.value).toBe(3)
    expect(list.matched.value).toBe(1)
  })

  it('freezes rows while paused and catches up on resume', async () => {
    const store = useMessagesStore()
    store.ingest(messages(2, { connectionId: 'a' }))
    const filter = reactive<MessageFilter>({ ...DEFAULT_MESSAGE_FILTER })
    const list = inScope(() => useMessageList('a', filter))
    store.setPaused('a', true)
    await nextTick()
    expect(list.paused.value).toBe(true)

    store.ingest(messages(3, { connectionId: 'a', topic: 'late' }))
    await vi.advanceTimersByTimeAsync(500)
    expect(list.rows.value).toHaveLength(2)
    expect(list.total.value).toBe(5)

    // A filter change while paused filters the frozen snapshot.
    filter.topic = 'late'
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)
    expect(list.rows.value).toHaveLength(0)

    store.setPaused('a', false)
    await nextTick()
    expect(list.rows.value.map((m) => m.topic)).toEqual(['late', 'late', 'late'])
  })

  it('shows a cleared buffer even while paused', async () => {
    const store = useMessagesStore()
    store.ingest(messages(2, { connectionId: 'a' }))
    const list = inScope(() => useMessageList('a', { ...DEFAULT_MESSAGE_FILTER }))
    store.setPaused('a', true)
    await nextTick()
    store.clear('a')
    await vi.advanceTimersByTimeAsync(100)
    expect(list.rows.value).toEqual([])
  })

  it('switches connections without showing the previous rows', async () => {
    const store = useMessagesStore()
    store.ingest(messages(2, { connectionId: 'a' }))
    const id = ref('a')
    const list = inScope(() => useMessageList(id, { ...DEFAULT_MESSAGE_FILTER }))
    expect(list.rows.value).toHaveLength(2)
    id.value = 'empty'
    await nextTick()
    expect(list.rows.value).toEqual([])
    expect(list.total.value).toBe(0)
  })

  it('re-filters a large buffer in slices, newest first, and ends with every match', async () => {
    // Real macrotasks for the slices; a clock that advances 0.5 ms per read.
    vi.useRealTimers()
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 0.5))
    try {
      const store = useMessagesStore()
      const batch = Array.from({ length: 3000 }, (_, i) =>
        message({ connectionId: 'a', topic: i % 3 === 0 ? 'hit' : 'miss' })
      )
      store.ingest(batch)
      const filter = reactive<MessageFilter>({ ...DEFAULT_MESSAGE_FILTER })
      const list = inScope(() => useMessageList('a', filter, { throttleMs: 0 }))
      expect(list.rows.value).toHaveLength(3000)

      filter.search = 'HIT'
      await nextTick()
      expect(list.pending.value).toBe(true)
      const first = list.rows.value
      const all = batch.filter((m) => m.topic === 'hit')
      expect(first.length).toBeGreaterThan(0)
      expect(first.length).toBeLessThan(all.length)
      expect(first).toEqual(all.slice(-first.length)) // the newest matches first

      for (let turn = 0; list.pending.value && turn < 100_000; turn++) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      expect(list.pending.value).toBe(false)
      expect(list.rows.value).toEqual(all)
    } finally {
      now.mockRestore()
    }
  })

  it('searches decoded payloads with the connection view format', async () => {
    const store = useMessagesStore()
    store.ingest([
      message({ connectionId: 'a', topic: 't', payload: utf8('{"state":"ON"}') }),
      message({ connectionId: 'a', topic: 't', payload: utf8('off') })
    ])
    const list = inScope(() =>
      useMessageList('a', { ...DEFAULT_MESSAGE_FILTER, search: '"STATE"' })
    )
    expect(list.rows.value).toHaveLength(1)
  })
})

describe('useTopicTreeRows', () => {
  it('flattens the live tree with expansion and search', async () => {
    const store = useMessagesStore()
    store.ingest([
      message({ connectionId: 'a', topic: 'home/kitchen' }),
      message({ connectionId: 'a', topic: 'office' })
    ])
    const expanded = ref(new Set<string>())
    const search = ref('')
    const tree = inScope(() => useTopicTreeRows('a', expanded, search))
    expect(tree.rows.value.map((r) => r.node.topic)).toEqual(['home', 'office'])
    expect(tree.topicCount.value).toBe(2)

    expanded.value.add('home')
    await nextTick()
    expect(tree.rows.value.map((r) => r.node.topic)).toEqual(['home', 'home/kitchen', 'office'])

    search.value = 'kit'
    await nextTick()
    expect(tree.rows.value.map((r) => r.node.topic)).toEqual(['home', 'home/kitchen'])

    search.value = ''
    store.ingest([message({ connectionId: 'a', topic: 'garage' })])
    await vi.advanceTimersByTimeAsync(200)
    expect(tree.rows.value.map((r) => r.node.topic)).toEqual([
      'garage',
      'home',
      'home/kitchen',
      'office'
    ])
    expect(tree.topicCount.value).toBe(3)
  })

  it('does not re-flatten when only counts changed, and still refreshes the rows', async () => {
    const store = useMessagesStore()
    store.ingest([message({ connectionId: 'a', topic: 'x/y' })])
    const expanded = ref(new Set<string>(['x']))
    const tree = inScope(() => useTopicTreeRows('a', expanded))
    const live = store.topicTree('a')
    const flatten = vi.spyOn(live, 'flattenView')
    const first = tree.rows.value

    store.ingest([message({ connectionId: 'a', topic: 'x/y' })])
    await vi.advanceTimersByTimeAsync(200)
    expect(flatten).not.toHaveBeenCalled()
    // A new array (views re-render), same rows, live counts on the nodes.
    expect(tree.rows.value).not.toBe(first)
    expect(tree.rows.value).toEqual(first)
    expect(tree.rows.value[1].node.messageCount).toBe(2)

    // A new topic changes the structure: flattened again.
    store.ingest([message({ connectionId: 'a', topic: 'x/z' })])
    await vi.advanceTimersByTimeAsync(200)
    expect(flatten).toHaveBeenCalledTimes(1)
    expect(tree.rows.value.map((row) => row.node.topic)).toEqual(['x', 'x/y', 'x/z'])
  })

  it('exposes position info and the match count with the rows', async () => {
    const store = useMessagesStore()
    store.ingest([
      message({ connectionId: 'a', topic: 'home/kitchen' }),
      message({ connectionId: 'a', topic: 'home/garage' }),
      message({ connectionId: 'a', topic: 'office' })
    ])
    const search = ref('')
    const tree = inScope(() => useTopicTreeRows('a', new Set(['home']), search))
    expect(tree.rows.value.map((row) => [row.node.topic, row.posInSet, row.setSize])).toEqual([
      ['home', 1, 2],
      ['home/garage', 1, 2],
      ['home/kitchen', 2, 2],
      ['office', 2, 2]
    ])
    expect(tree.matchCount.value).toBe(3)
    search.value = 'GAR'
    await nextTick()
    expect(tree.matchCount.value).toBe(1)
    expect(tree.rows.value.filter((row) => row.node.messageCount > 0)).toHaveLength(1)
  })
})

describe('useFormatters / previewOf', () => {
  it('formats timestamps according to the settings', async () => {
    const settings = useSettingsStore()
    const format = useFormatters()
    const ts = new Date(2026, 0, 2, 3, 4, 5, 6).getTime()
    expect(format.time(ts)).toBe('03:04:05.006')
    await settings.update({ timestampFormat: 'datetime', showMilliseconds: false })
    expect(format.time(ts)).toBe('2026-01-02 03:04:05')
    expect(format.clock(ts)).toBe('03:04:05')
    expect(format.bytes(2048)).toBe('2.0 KB')
    expect(format.duration(61_000)).toBe('1:01')
  })

  it('caches previews per message and format', () => {
    const m = message({ payload: utf8('{\n  "a": 1\n}') })
    const preview = previewOf(m, 'auto')
    expect(preview).toBe('{ "a": 1 }')
    expect(previewOf(m, 'auto')).toBe(preview)
    expect(previewOf(m, 'hex', 8)).toBe('7b 0a 20…')
  })
})
