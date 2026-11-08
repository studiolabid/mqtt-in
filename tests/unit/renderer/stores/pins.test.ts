import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { notifyConnectionRemoved } from '@/stores/connection-lifecycle'
import { useMessagesStore } from '@/stores/messages'
import {
  MAX_PINS_PER_CONNECTION,
  PIN_SERIES_POINTS,
  PINS_STORAGE_KEY,
  usePinsStore
} from '@/stores/pins'
import { parsePins } from '@/stores/pins-storage'
import { message, utf8 } from '../helpers'
import { setupStores, type StoreSetup } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

describe('usePinsStore (CT-13)', () => {
  let setup: StoreSetup

  beforeEach(async () => {
    vi.clearAllMocks()
    setup = await setupStores()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function loaded(): Promise<ReturnType<typeof usePinsStore>> {
    const pins = usePinsStore()
    await pins.load()
    return pins
  }

  it('pins, unpins and toggles, persisted through the storage (debounced)', async () => {
    vi.useFakeTimers()
    const pins = await loaded()
    const first = pins.pin('c1', 'home/temp', '')
    expect(first).toMatchObject({ topic: 'home/temp', field: '' })
    expect(pins.pin('c1', 'home/temp', '')).toEqual(first) // already pinned: the same pin
    expect(pins.isPinned('c1', 'home/temp')).toBe(true)
    expect(pins.isPinned('c1', 'home/temp', 'value')).toBe(false)
    expect(pins.toggle('c1', 'home/env', 'hum')).toBe(true)
    expect(pins.list('c1').map((p) => p.topic)).toEqual(['home/temp', 'home/env'])

    await vi.advanceTimersByTimeAsync(600)
    expect(setup.bridge.storage.get(PINS_STORAGE_KEY)).toEqual({
      c1: [
        { id: first?.id, topic: 'home/temp', field: '' },
        { id: expect.any(String), topic: 'home/env', field: 'hum' }
      ]
    })

    expect(pins.toggle('c1', 'home/env', 'hum')).toBe(false)
    if (first) pins.unpin('c1', first.id)
    expect(pins.list('c1')).toEqual([])
    await vi.advanceTimersByTimeAsync(600)
    expect(setup.bridge.storage.get(PINS_STORAGE_KEY)).toEqual({})
  })

  it('refuses the 9th pin of a connection', async () => {
    const pins = await loaded()
    for (let i = 0; i < MAX_PINS_PER_CONNECTION; i++) {
      expect(pins.pin('c1', `t/${i}`, 'value')).not.toBeNull()
    }
    expect(pins.pin('c1', 't/8', 'value')).toBeNull()
    expect(pins.toggle('c1', 't/8', 'value')).toBe(false)
    expect(pins.list('c1')).toHaveLength(8)
    // Other connections have their own limit.
    expect(pins.pin('c2', 't/8', 'value')).not.toBeNull()
  })

  it('loads the stored pins and never overwrites them after a failed read', async () => {
    setup.bridge.storage.set(PINS_STORAGE_KEY, {
      c1: [{ id: 'p1', topic: 'a', field: 'x' }, { id: 'bad' }]
    })
    const pins = await loaded()
    expect(pins.list('c1')).toEqual([{ id: 'p1', topic: 'a', field: 'x' }])

    setup = await setupStores()
    vi.mocked(setup.bridge.api.storage.get).mockRejectedValueOnce(new Error('io'))
    const failed = usePinsStore()
    await expect(failed.load()).rejects.toThrow('io')
    failed.pin('c1', 'b', '')
    await failed.flush()
    expect(setup.bridge.api.storage.set).not.toHaveBeenCalled()
  })

  it('feeds incoming values on ingest; the series survive the buffer eviction', async () => {
    await useSettingsStore().update({ maxMessagesPerConnection: 100 })
    const pins = await loaded()
    const messages = useMessagesStore()
    const temp = pins.pin('c1', 'sensor/t', '')
    const hum = pins.pin('c1', 'sensor/env', 'hum')
    if (!temp || !hum) throw new Error('not pinned')
    const batch = Array.from({ length: 20_000 }, (_, i) =>
      message({ connectionId: 'c1', topic: 'sensor/t', payload: utf8(String(i)), timestamp: i })
    )
    for (let i = 0; i < batch.length; i += 500) messages.ingest(batch.slice(i, i + 500))
    messages.ingest([
      message({ connectionId: 'c1', topic: 'sensor/env', payload: utf8('{"hum":41.5,"t":1}') }),
      message({ connectionId: 'c1', topic: 'sensor/env', payload: utf8('{"t":2}') }),
      message({ connectionId: 'c1', topic: 'other', payload: utf8('7') }),
      message({ connectionId: 'c1', direction: 'out', topic: 'sensor/t', payload: utf8('-1') })
    ])
    expect(messages.count('c1')).toBeLessThanOrEqual(100)

    const series = pins.series('c1', temp.id)
    expect(series.length).toBe(PIN_SERIES_POINTS)
    expect(series.values[0]).toBe(20_000 - PIN_SERIES_POINTS)
    expect(series.values[PIN_SERIES_POINTS - 1]).toBe(19_999)
    expect(series.times[PIN_SERIES_POINTS - 1]).toBe(19_999)
    expect(pins.latest('c1', temp.id)).toEqual({
      value: 19_999,
      timestamp: 19_999,
      previous: 19_998
    })
    expect(pins.series('c1', hum.id).length).toBe(1)
    expect(pins.latest('c1', hum.id)).toEqual({ value: 41.5, timestamp: expect.any(Number) })
    // A copy: mutating it does not change the ring.
    series.values[0] = -5
    expect(pins.series('c1', temp.id).values[0]).toBe(20_000 - PIN_SERIES_POINTS)
  })

  it('seeds a new pin from the messages still in the buffer', async () => {
    const pins = await loaded()
    useMessagesStore().ingest([
      message({ connectionId: 'c1', topic: 'm', payload: utf8('1'), timestamp: 1 }),
      message({ connectionId: 'c1', topic: 'm', payload: utf8('true'), timestamp: 2 }),
      message({ connectionId: 'c1', topic: 'm', payload: utf8('{"value":3}'), timestamp: 3 })
    ])
    const bare = pins.pin('c1', 'm', '')
    const value = pins.pin('c1', 'm', 'value')
    if (!bare || !value) throw new Error('not pinned')
    // '' = the bare-number payload; 'value' = the extractNumbers key (bare numbers too).
    expect(Array.from(pins.series('c1', bare.id).values)).toEqual([1, 1])
    expect(Array.from(pins.series('c1', value.id).values)).toEqual([1, 1, 3])
  })

  it('bumps the revision once per batch that added points', async () => {
    const pins = await loaded()
    const messages = useMessagesStore()
    const pin = pins.pin('c1', 'a', '')
    if (!pin) throw new Error('not pinned')
    const start = pins.revision('c1')
    messages.ingest([
      message({ connectionId: 'c1', topic: 'a', payload: utf8('1') }),
      message({ connectionId: 'c1', topic: 'a', payload: utf8('2') })
    ])
    expect(pins.revision('c1')).toBe(start + 1)
    messages.ingest([message({ connectionId: 'c1', topic: 'b', payload: utf8('3') })])
    messages.ingest([message({ connectionId: 'c1', topic: 'a', payload: utf8('text') })])
    expect(pins.revision('c1')).toBe(start + 1)
    expect(pins.revision('c2')).toBe(0)
    await nextTick()
  })

  it('drops the pins of a removed connection', async () => {
    vi.useFakeTimers()
    const pins = await loaded()
    const pin = pins.pin('c1', 'a', '')
    pins.pin('c2', 'b', '')
    if (!pin) throw new Error('not pinned')
    notifyConnectionRemoved('c1')
    expect(pins.list('c1')).toEqual([])
    expect(pins.series('c1', pin.id).length).toBe(0)
    expect(pins.revision('c1')).toBe(0)
    expect(pins.list('c2')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(600)
    expect(setup.bridge.storage.get(PINS_STORAGE_KEY)).toEqual({ c2: [expect.any(Object)] })
    pins.prune(new Set())
    expect(pins.list('c2')).toEqual([])
  })

  it('validates stored data', () => {
    expect(parsePins(null, 8)).toEqual({})
    expect(parsePins([], 8)).toEqual({})
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, topic: `t${i}`, field: '' }))
    const parsed = parsePins(
      {
        c1: many,
        c2: [
          { id: 'a', topic: 't', field: 'x' },
          { id: 'b', topic: 't', field: 'x' },
          { id: '', topic: 'u', field: '' },
          'junk'
        ],
        c3: 'junk'
      },
      8
    )
    expect(parsed.c1).toHaveLength(8)
    expect(parsed.c2).toEqual([{ id: 'a', topic: 't', field: 'x' }])
    expect(parsed.c3).toBeUndefined()
    expect(Object.getPrototypeOf(parsePins(JSON.parse('{"__proto__":[]}'), 8))).toBe(
      Object.prototype
    )
  })
})
