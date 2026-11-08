/**
 * Coarse performance guards for the message pipeline (generous bounds: they catch accidental
 * quadratic behavior, not micro regressions).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MqttMessage, ViewFormat } from '@shared/models'
import { useMessagesStore } from '@/stores/messages'
import { useSettingsStore } from '@/stores/settings'
import { DEFAULT_MESSAGE_FILTER } from '@/types'
import { FilteredView } from '@/utils/filtered-view'
import { createMessagePredicate } from '@/utils/message-filter'
import { TopicTree } from '@/utils/topic-tree'
import { mixedCorpus } from './corpus'
import { message, utf8 } from './helpers'
import { setupStores } from './stores/setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6
}

function batches(count: number, size: number): MqttMessage[][] {
  return Array.from({ length: count }, (_, b) =>
    Array.from({ length: size }, (_, i) =>
      message({
        connectionId: 'perf',
        topic: `site/${(b * size + i) % 50}/sensor/${i % 7}`,
        payload: utf8(`{"t":${i % 40},"seq":${b * size + i},"status":"ok"}`),
        timestamp: b * 1000 + i
      })
    )
  )
}

describe('message pipeline performance', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    await setupStores()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ingests and filters one minute at 2 000 msg/s in well under a second of work', async () => {
    await useSettingsStore().update({ maxMessagesPerConnection: 10_000 })
    const store = useMessagesStore()
    const input = batches(120, 1000)
    const view = new FilteredView(
      createMessagePredicate({ ...DEFAULT_MESSAGE_FILTER, topic: 'site/+/sensor/3', search: 'ok' })
    )

    const start = process.hrtime.bigint()
    for (const batch of input) {
      store.ingest(batch)
      view.sync(store.sourceOf('perf'))
    }
    const ms = elapsedMs(start)

    expect(store.count('perf')).toBeLessThanOrEqual(10_000)
    expect(store.stats('perf').received).toBe(120_000)
    expect(view.rows.length).toBeGreaterThan(0)
    expect(view.rows.every((m) => m.topic.endsWith('/sensor/3'))).toBe(true)
    expect(ms).toBeLessThan(3000)
  })

  it('searches 100k mixed messages (1 KB binary, 50 KB JSON) without decoding them', () => {
    const corpus = mixedCorpus(100_000)
    const source = { messages: corpus, evicted: 0, appended: corpus.length, generation: 1 }
    const searchFor = (search: string, viewFormat: ViewFormat): FilteredView => {
      const view = new FilteredView(
        createMessagePredicate({ ...DEFAULT_MESSAGE_FILTER, search }, { viewFormat })
      )
      view.sync(source)
      return view
    }

    const start = process.hrtime.bigint()
    const text = searchFor('Nominal', 'auto')
    const missing = searchFor('no such text', 'auto')
    const bytes = searchFor('de ad', 'hex')
    const ms = elapsedMs(start)

    expect(text.rows).toHaveLength(30_000)
    expect(missing.rows).toHaveLength(0)
    expect(bytes.rows.length).toBeGreaterThan(0)
    // About 300 ms for the three searches (PERF-01 measured 1.1-1.4 s for one cold Auto search
    // at 100k and 2.8 s in the Hex view, before the byte search).
    expect(ms).toBeLessThan(1200)
  })

  it('flattens a 10 000 topic tree quickly', () => {
    const tree = new TopicTree()
    for (let i = 0; i < 10_000; i++) {
      tree.add(message({ topic: `building/${i % 20}/floor/${i % 10}/room/${i}` }))
    }
    const expanded = new Set<string>(['building'])
    for (let b = 0; b < 20; b++) expanded.add(`building/${b}`)

    const start = process.hrtime.bigint()
    const rows = tree.flatten(expanded)
    const searched = tree.flatten(new Set(), 'room/99')
    const ms = elapsedMs(start)

    // building, then each expanded building/N with its single (collapsed) floor level
    expect(rows).toHaveLength(1 + 20 * 2)
    expect(searched.some((row) => row.node.topic.endsWith('room/9999'))).toBe(true)
    expect(ms).toBeLessThan(1000)
  })
})
