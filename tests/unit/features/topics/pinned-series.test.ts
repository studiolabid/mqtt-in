/**
 * FP-3 (UI part): pins turned into tiles (label, value, delta, sparkline) and chart series
 * (one legend entry per pin, cut to the window), and the 8-pin limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, type EffectScope } from 'vue'
import { toast } from 'vue-sonner'
import {
  chipPinField,
  PIN_LIMIT_MESSAGE,
  pinFieldOf,
  pinLabels,
  pinnedChartNote,
  pinnedChartSeries,
  pinTiles,
  SPARK_POINTS,
  usePinnedSeries,
  usePinToggle,
  windowPoints,
  type PinReader
} from '@/features/topics/composables/usePinnedSeries'
import { seriesColor } from '@/features/topics/utils/palette'
import { useMessagesStore } from '@/stores/messages'
import { PIN_SERIES_POINTS, usePinsStore, type PinSeries, type TopicPin } from '@/stores/pins'
import { message, utf8 } from '../../renderer/helpers'
import { setupStores } from '../../renderer/stores/setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

function pin(topic: string, field = '', id = `${topic}#${field}`): TopicPin {
  return { id, topic, field }
}

function series(points: Array<[number, number]>): PinSeries {
  return {
    times: Float64Array.from(points.map(([time]) => time)),
    values: Float64Array.from(points.map(([, value]) => value)),
    length: points.length
  }
}

/** A reader over fixed series (latest = last point, previous = the one before). */
function reader(byPin: Record<string, Array<[number, number]>>): PinReader {
  return {
    series: (pinId) => series(byPin[pinId] ?? []),
    latest(pinId) {
      const points = byPin[pinId] ?? []
      const last = points.at(-1)
      if (!last) return undefined
      const before = points.at(-2)
      return before
        ? { value: last[1], timestamp: last[0], previous: before[1] }
        : { value: last[1], timestamp: last[0] }
    }
  }
}

describe('pin labels', () => {
  it('use the last topic level and the field', () => {
    expect(pinLabels([pin('home/kitchen/temp'), pin('home/env', 'humidity')])).toEqual([
      'temp',
      'env · humidity'
    ])
  })

  it('add a level to a one or two letter tail', () => {
    expect(pinLabels([pin('num/a'), pin('a'), pin('num/b', 'temp')])).toEqual([
      'num/a',
      'a',
      'num/b · temp'
    ])
  })

  it('add levels where two pins would read the same', () => {
    expect(
      pinLabels([pin('home/kitchen/temp'), pin('home/bath/temp'), pin('garage/door')])
    ).toEqual(['kitchen/temp', 'bath/temp', 'door'])
  })
})

describe('pinTiles', () => {
  it('shows the latest value, the delta and the newest values', () => {
    const points: Array<[number, number]> = Array.from({ length: 80 }, (_, i) => [i * 1000, i])
    const [tile] = pinTiles([pin('a/temp')], reader({ 'a/temp#': points }), false)
    expect(tile).toMatchObject({ label: 'temp', title: 'a/temp', value: 79, delta: 1 })
    expect(tile.timestamp).toBe(79_000)
    expect(tile.spark).toHaveLength(SPARK_POINTS)
    expect(tile.spark.at(-1)).toBe(79)
    expect(tile.color).toBe(seriesColor(0, false))
  })

  it('has no delta for a single value and no value before the first', () => {
    const tiles = pinTiles([pin('a'), pin('b')], reader({ 'a#': [[1, 5]], 'b#': [] }), true)
    expect(tiles[0]).toMatchObject({ value: 5, delta: null, color: seriesColor(0, true) })
    expect(tiles[1]).toMatchObject({ value: null, delta: null, spark: [] })
    expect(tiles[1].color).toBe(seriesColor(1, true))
  })
})

describe('the pinned chart', () => {
  const pins = [pin('room/a', 'temp'), pin('room/b', 'temp')]
  const data = reader({
    'room/a#temp': [
      [1_000, 20],
      [61_000, 21],
      [121_000, 22]
    ],
    'room/b#temp': [[100_000, 5]]
  })

  it('cuts every series to the window', () => {
    expect(windowPoints(data.series('room/a#temp'), 60_000)).toEqual([
      [61_000, 21],
      [121_000, 22]
    ])
    expect(windowPoints(data.series('room/a#temp'), 0)).toHaveLength(3)
    expect(windowPoints(data.series('room/a#temp'), 200_000)).toEqual([])
  })

  it('draws one series per pin, named like its tile (one legend entry each)', () => {
    const chart = pinnedChartSeries(pins, data, 60_000, false)
    expect(chart.map((entry) => entry.name)).toEqual(['room/a · temp', 'room/b · temp'])
    expect(chart.map((entry) => entry.color)).toEqual([
      seriesColor(0, false),
      seriesColor(1, false)
    ])
    expect(chart[0].points).toEqual([
      [61_000, 21],
      [121_000, 22]
    ])
    expect(chart[1].points).toEqual([[100_000, 5]])
  })

  it('notes a full ring that covers less than the window', () => {
    const full: Array<[number, number]> = Array.from({ length: PIN_SERIES_POINTS }, (_, i) => [
      i * 20,
      i
    ])
    const busy = reader({ 'fast#': full })
    expect(pinnedChartNote([pin('fast')], busy, 15 * 60_000)).toBe(
      'Each pin keeps its newest 2,000 values: fast covers the last 40 s'
    )
    expect(pinnedChartNote([pin('fast')], busy, 10_000)).toBeNull()
    expect(pinnedChartNote(pins, data, 15 * 60_000)).toBeNull()
  })
})

describe('pin fields', () => {
  it('pins a bare number as itself and JSON by its first numeric field', () => {
    expect(pinFieldOf(message({ payload: utf8('21.5') }))).toBe('')
    expect(pinFieldOf(message({ payload: utf8('{"temp":21.5,"hum":40}') }))).toBe('temp')
    expect(pinFieldOf(message({ payload: utf8('{"value":3}') }))).toBe('value')
    expect(pinFieldOf(message({ payload: utf8('online') }))).toBeNull()
    expect(pinFieldOf(undefined)).toBeNull()
  })

  it('maps the chips "value" of a bare number to the topic pin', () => {
    expect(chipPinField('value', message({ payload: utf8('7') }))).toBe('')
    expect(chipPinField('value', message({ payload: utf8('{"value":7}') }))).toBe('value')
    expect(chipPinField('temp', message({ payload: utf8('{"temp":7}') }))).toBe('temp')
  })
})

describe('with the pins store', () => {
  let scope: EffectScope

  beforeEach(async () => {
    vi.clearAllMocks()
    await setupStores()
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.unstubAllGlobals()
  })

  it('toasts at the limit instead of pinning a ninth value', () => {
    const toggle = scope.run(() => usePinToggle(() => 'c1'))
    if (!toggle) throw new Error('no scope')
    for (let i = 0; i < 8; i++) expect(toggle.toggle(`t/${i}`, '')).toBe(true)
    expect(toggle.toggle('t/8', '')).toBe(false)
    expect(toast.info).toHaveBeenCalledWith(PIN_LIMIT_MESSAGE)
    expect(PIN_LIMIT_MESSAGE).toBe('Unpin one first (8 pins max)')
    // Unpinning never toasts.
    vi.mocked(toast.info).mockClear()
    expect(toggle.toggle('t/0', '')).toBe(false)
    expect(toast.info).not.toHaveBeenCalled()
    expect(toggle.isPinned('t/0', '')).toBe(false)
  })

  it('shows a new pin at once, seeded from the buffer', async () => {
    const messages = useMessagesStore()
    messages.ingest([
      message({ connectionId: 'c1', topic: 'lab/temp', payload: utf8('20'), timestamp: 1_000 }),
      message({ connectionId: 'c1', topic: 'lab/temp', payload: utf8('21'), timestamp: 2_000 })
    ])
    const pinned = scope.run(() =>
      usePinnedSeries({
        connectionId: () => 'c1',
        window: () => 'all',
        dark: () => false,
        chart: () => true
      })
    )
    if (!pinned) throw new Error('no scope')
    expect(pinned.tiles.value).toEqual([])
    usePinsStore().pin('c1', 'lab/temp', '')
    await nextTick()
    expect(pinned.tiles.value.map((tile) => [tile.label, tile.value, tile.delta])).toEqual([
      ['temp', 21, 1]
    ])
    expect(pinned.chartSeries.value).toHaveLength(1)
    expect(pinned.chartSeries.value[0].points).toEqual([
      [1_000, 20],
      [2_000, 21]
    ])
  })
})
