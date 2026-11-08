/**
 * Pinned values (FP-3) for display, from the pin rings of `usePinsStore` (CT-13), so the
 * message buffer's eviction never shortens them:
 * - one tile per pin: a short unique label, the latest value, the change since the previous
 *   value and a sparkline, in the pin's chart color (pin order = palette slot);
 * - the series of the pinned chart, cut to its time window;
 * - `usePinToggle`: pin / unpin a topic field, with the 8-pin limit toast.
 *
 * Tiles and series are re-read at most every 250 ms while points arrive and are frozen while
 * the connection's views are paused (like the topic tree); pinning and unpinning show at once.
 */
import { computed, onScopeDispose, shallowRef, watch, type ComputedRef, type ShallowRef } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { MqttMessage } from '@shared/models'
import { useMessagesStore } from '@/stores/messages'
import {
  MAX_PINS_PER_CONNECTION,
  PIN_SERIES_POINTS,
  usePinsStore,
  type PinLatest,
  type PinSeries,
  type TopicPin
} from '@/stores/pins'
import type { ChartSeries } from '@/types'
import { BARE_NUMBER_FIELD, bareNumber } from '@/utils/numeric'
import { throttle } from '@/utils/throttle'
import { chartWindow, numbersOf, type ChartWindowId } from '../utils/chart-data'
import { coverageMs, formatSpan } from '../utils/coverage'
import { seriesColor } from '../utils/palette'

/** Values drawn by a tile's sparkline. */
export const SPARK_POINTS = 60
const REFRESH_MS = 250
/** Re-cut a time window this often while no points arrive. */
const WINDOW_TICK_MS = 2000

export const PIN_LIMIT_MESSAGE = `Unpin one first (${MAX_PINS_PER_CONNECTION} pins max)`

export interface PinnedTile {
  pin: TopicPin
  /** Short and unique among the pins: `temp`, `kitchen/temp · humidity`. */
  label: string
  /** Topic and field in full (tooltips, accessible names). */
  title: string
  value: number | null
  /** Change since the previous value (null without one). */
  delta: number | null
  timestamp: number | null
  /** The newest values, oldest first (sparkline). */
  spark: number[]
  color: string
}

/** What the tiles and series are read from (the pins store, bound to a connection). */
export interface PinReader {
  series(pinId: string): PinSeries
  latest(pinId: string): PinLatest | undefined
}

/** Topic and field as one line (`home/temp` for a bare-number pin, `home/env · humidity`). */
export function pinTitle(pin: TopicPin): string {
  return pin.field === BARE_NUMBER_FIELD ? pin.topic : `${pin.topic} · ${pin.field}`
}

/**
 * Short labels: the last topic level (and the field), with more levels for pins that would
 * otherwise read the same (`kitchen/temp` and `bath/temp`) and for a cryptic one or two letter
 * tail (`num/a`, not `a`).
 */
export function pinLabels(pins: readonly TopicPin[]): string[] {
  const levels = pins.map((pin) => pin.topic.split('/'))
  const depth = levels.map((parts) =>
    parts.length > 1 && parts[parts.length - 1].length < 3 ? 2 : 1
  )
  const label = (i: number): string => {
    const tail = levels[i].slice(-depth[i]).join('/') || '(empty)'
    return pins[i].field === BARE_NUMBER_FIELD ? tail : `${tail} · ${pins[i].field}`
  }
  for (;;) {
    const labels = pins.map((_, i) => label(i))
    const counts = new Map<string, number>()
    for (const text of labels) counts.set(text, (counts.get(text) ?? 0) + 1)
    let longer = false
    labels.forEach((text, i) => {
      if ((counts.get(text) ?? 0) > 1 && depth[i] < levels[i].length) {
        depth[i]++
        longer = true
      }
    })
    if (!longer) return labels
  }
}

/** The points at or after `since` as chart tuples (series are oldest first). */
export function windowPoints(series: PinSeries, since: number): Array<[number, number]> {
  let start = series.length
  while (start > 0 && series.times[start - 1] >= since) start--
  const points: Array<[number, number]> = []
  for (let i = start; i < series.length; i++) points.push([series.times[i], series.values[i]])
  return points
}

/** The tiles of the pins (pin order; colors by slot). */
export function pinTiles(pins: readonly TopicPin[], read: PinReader, dark: boolean): PinnedTile[] {
  const labels = pinLabels(pins)
  return pins.map((pin, slot) => {
    const latest = read.latest(pin.id)
    const series = read.series(pin.id)
    const from = Math.max(0, series.length - SPARK_POINTS)
    return {
      pin,
      label: labels[slot],
      title: pinTitle(pin),
      value: latest?.value ?? null,
      delta: latest && latest.previous !== undefined ? latest.value - latest.previous : null,
      timestamp: latest?.timestamp ?? null,
      spark: Array.from(series.values.subarray(from, series.length)),
      color: seriesColor(slot, dark)
    }
  })
}

/** One chart series per pin (its tile label as the legend), cut to `since`. */
export function pinnedChartSeries(
  pins: readonly TopicPin[],
  read: Pick<PinReader, 'series'>,
  since: number,
  dark: boolean
): ChartSeries[] {
  const labels = pinLabels(pins)
  return pins.map((pin, slot) => ({
    name: labels[slot],
    color: seriesColor(slot, dark),
    points: windowPoints(read.series(pin.id), since)
  }))
}

/**
 * A caveat for the pinned chart: a pin keeps its newest `PIN_SERIES_POINTS` values, so a busy
 * topic covers less than a long window. Null when every pin covers the window.
 */
export function pinnedChartNote(
  pins: readonly TopicPin[],
  read: Pick<PinReader, 'series'>,
  windowMs: number
): string | null {
  const labels = pinLabels(pins)
  for (let slot = 0; slot < pins.length; slot++) {
    const series = read.series(pins[slot].id)
    if (series.length < PIN_SERIES_POINTS) continue
    const span = coverageMs(series.times[0], series.times[series.length - 1])
    if (span < windowMs) {
      return `Each pin keeps its newest ${PIN_SERIES_POINTS.toLocaleString('en-US')} values: ${labels[slot]} covers the last ${formatSpan(span)}`
    }
  }
  return null
}

const primaryFields = new WeakMap<MqttMessage, string | null>()

/**
 * The field a topic-level pin follows for this payload: `''` for a bare number, else the first
 * numeric JSON field; null when the payload holds no number (not pinnable). Cached per message.
 */
export function pinFieldOf(message: MqttMessage | undefined): string | null {
  if (!message) return null
  let field = primaryFields.get(message)
  if (field === undefined) {
    const keys = Object.keys(numbersOf(message) ?? {})
    if (keys.length === 0) field = null
    else if (keys.length === 1 && keys[0] === 'value' && bareNumber(message.payload) !== null) {
      field = BARE_NUMBER_FIELD
    } else field = keys[0]
    primaryFields.set(message, field)
  }
  return field
}

/**
 * The pin field of a chart field chip: the chips call a bare number `value`, which a topic pin
 * stores as `''` (so the header, the tree and the chips agree on one pin).
 */
export function chipPinField(field: string, last: MqttMessage | undefined): string {
  if (field !== 'value' || !last) return field
  return pinFieldOf(last) === BARE_NUMBER_FIELD ? BARE_NUMBER_FIELD : field
}

export interface PinToggle {
  isPinned(topic: string, field: string): boolean
  /** Pins or unpins; at the limit it toasts `PIN_LIMIT_MESSAGE`. @returns pinned afterwards. */
  toggle(topic: string, field: string): boolean
}

export function usePinToggle(connectionId: () => string): PinToggle {
  const pins = usePinsStore()
  return {
    isPinned: (topic, field) => pins.isPinned(connectionId(), topic, field),
    toggle(topic, field) {
      const id = connectionId()
      const wasPinned = pins.isPinned(id, topic, field)
      const pinned = pins.toggle(id, topic, field)
      if (!pinned && !wasPinned) toast.info(PIN_LIMIT_MESSAGE)
      return pinned
    }
  }
}

export interface PinnedSeriesOptions {
  connectionId: () => string
  window: () => ChartWindowId
  dark: () => boolean
  /** Whether the chart is shown (its series are only built then). */
  chart: () => boolean
}

export interface PinnedSeries {
  pins: ComputedRef<readonly TopicPin[]>
  tiles: ShallowRef<PinnedTile[]>
  chartSeries: ShallowRef<ChartSeries[]>
  /** See `pinnedChartNote`. */
  chartNote: ShallowRef<string | null>
}

export function usePinnedSeries(options: PinnedSeriesOptions): PinnedSeries {
  const store = usePinsStore()
  const messages = useMessagesStore()
  const pins = computed(() => store.list(options.connectionId()))
  const tiles = shallowRef<PinnedTile[]>([])
  const chartSeries = shallowRef<ChartSeries[]>([])
  const chartNote = shallowRef<string | null>(null)

  function update(): void {
    const id = options.connectionId()
    const list = store.list(id)
    const read: PinReader = {
      series: (pinId) => store.series(id, pinId),
      latest: (pinId) => store.latest(id, pinId)
    }
    const dark = options.dark()
    tiles.value = pinTiles(list, read, dark)
    if (!options.chart() || list.length === 0) {
      chartSeries.value = []
      chartNote.value = null
      return
    }
    const windowMs = chartWindow(options.window()).ms
    chartSeries.value = pinnedChartSeries(list, read, Date.now() - windowMs, dark)
    chartNote.value = pinnedChartNote(list, read, windowMs)
  }

  const schedule = throttle(update, REFRESH_MS)
  watch(
    () => store.revision(options.connectionId()),
    () => {
      if (!messages.isPaused(options.connectionId())) schedule()
    }
  )
  watch(
    () => messages.isPaused(options.connectionId()),
    (paused) => {
      if (!paused) schedule()
    }
  )
  watch([pins, options.connectionId, options.window, options.dark, options.chart], update, {
    immediate: true
  })

  const ticker = useIntervalFn(
    () => {
      if (!messages.isPaused(options.connectionId())) update()
    },
    WINDOW_TICK_MS,
    { immediate: false }
  )
  watch(
    () => options.chart() && options.window() !== 'all',
    (sliding) => (sliding ? ticker.resume() : ticker.pause()),
    { immediate: true }
  )
  onScopeDispose(() => schedule.cancel())

  return { pins, tiles, chartSeries, chartNote }
}
