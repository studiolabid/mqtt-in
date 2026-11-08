/**
 * Chart model of one topic: numeric fields found in its history, the selected fields (each
 * owning a palette slot while selected), the series + statistics of the chosen window, and how
 * much of that window the history really covers (PERF-05: older messages may have been dropped
 * by the buffer or the point cap, see `utils/coverage`).
 */
import { computed, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { MqttMessage } from '@shared/models'
import type { ChartSeries } from '@/types'
import {
  buildFieldData,
  chartWindow,
  discoverFields,
  scalesDiffer,
  type ChartWindowId,
  type FieldStats
} from '../utils/chart-data'
import { chartCoverage, type ChartCoverage } from '../utils/coverage'
import { freeSlot, MAX_SERIES, seriesColor } from '../utils/palette'
import { rememberChartFields, rememberedChartFields } from './explorer-state'

/** Fields selected the first time a topic is charted. */
const DEFAULT_SELECTION = 3
/** Re-cut a time window this often while no messages arrive. */
const WINDOW_TICK_MS = 2000

export interface ChartRow {
  field: string
  color: string
  stats: FieldStats
}

export interface TopicChart {
  /** Numeric fields of the topic, first-seen order. */
  fields: ShallowRef<string[]>
  /** Selected field → palette slot. */
  selection: ShallowRef<ReadonlyMap<string, number>>
  /** Chart series of the selected fields (new arrays on every update). */
  series: ShallowRef<ChartSeries[]>
  /** Statistics per selected field over the window. */
  rows: ShallowRef<ChartRow[]>
  /** Selected series have very different magnitudes (suggest the split layout). */
  scalesDiffer: Ref<boolean>
  /** Every series of the window is empty. */
  windowEmpty: Ref<boolean>
  colorOf(field: string): string | undefined
  toggle(field: string): void
  /** Whether another field can be selected (palette not exhausted). */
  canSelectMore: Ref<boolean>
  /** What the history covers of the selected window (`partial`: less, and data was dropped). */
  coverage: ShallowRef<ChartCoverage>
}

export interface TopicChartOptions {
  connectionId: () => string
  topic: () => string
  history: ShallowRef<readonly MqttMessage[]>
  window: () => ChartWindowId
  dark: () => boolean
  /** Messages received on the topic in total (the topic tree's count, evicted ones included). */
  received: () => number
  /** Most messages `history` holds (`HISTORY_LIMIT`). */
  pointLimit: number
}

export function useTopicChart(options: TopicChartOptions): TopicChart {
  const fields = shallowRef<string[]>([])
  const selection = shallowRef<ReadonlyMap<string, number>>(new Map())
  const series = shallowRef<ChartSeries[]>([])
  const rows = shallowRef<ChartRow[]>([])
  const coverage = shallowRef<ChartCoverage>({ coverageMs: 0, limit: null, partial: false })
  /** No choice made for this topic yet: pick the defaults once fields show up. */
  let pendingDefault = true

  function colorOf(field: string): string | undefined {
    const slot = selection.value.get(field)
    return slot === undefined ? undefined : seriesColor(slot, options.dark())
  }

  function setSelection(next: ReadonlyMap<string, number>): void {
    selection.value = next
    rememberChartFields(options.connectionId(), options.topic(), next)
  }

  function loadSelection(): void {
    const remembered = rememberedChartFields(options.connectionId(), options.topic())
    pendingDefault = remembered === undefined
    selection.value = remembered ?? new Map()
  }

  /** Drops selected fields that vanished from the history; applies the default selection. */
  function reconcileSelection(): void {
    const known = fields.value
    if (known.length === 0) return
    if (pendingDefault) {
      pendingDefault = false
      const initial = new Map<string, number>()
      known.slice(0, DEFAULT_SELECTION).forEach((field, slot) => initial.set(field, slot))
      setSelection(initial)
      return
    }
    const present = new Set(known)
    if (Array.from(selection.value.keys()).every((field) => present.has(field))) return
    setSelection(new Map(Array.from(selection.value).filter(([field]) => present.has(field))))
  }

  function rebuild(): void {
    const chosen = fields.value.filter((field) => selection.value.has(field))
    const windowMs = chartWindow(options.window()).ms
    const since = Date.now() - windowMs
    const history = options.history.value
    coverage.value = chartCoverage({
      history,
      received: options.received(),
      pointLimit: options.pointLimit,
      windowMs
    })
    const data = buildFieldData(history, chosen, since)
    const dark = options.dark()
    series.value = data.map(({ field, points }) => ({
      name: field,
      color: seriesColor(selection.value.get(field) ?? 0, dark),
      points
    }))
    rows.value = data.map(({ field, stats }) => ({
      field,
      color: seriesColor(selection.value.get(field) ?? 0, dark),
      stats
    }))
  }

  function refreshFields(): void {
    const next = discoverFields(options.history.value)
    const current = fields.value
    // Keep the array (and the chips) when the fields did not change.
    if (next.length !== current.length || next.some((field, i) => field !== current[i])) {
      fields.value = next
    }
    reconcileSelection()
    rebuild()
  }

  function toggle(field: string): void {
    const next = new Map(selection.value)
    if (next.has(field)) next.delete(field)
    else {
      const slot = freeSlot(next.values())
      if (slot === null) return
      next.set(field, slot)
    }
    pendingDefault = false
    setSelection(next)
    rebuild()
  }

  watch(
    [options.connectionId, options.topic],
    () => {
      loadSelection()
      refreshFields()
    },
    { immediate: true }
  )
  watch(options.history, refreshFields)
  watch([options.window, options.dark], rebuild)

  const sliding = computed(() => options.window() !== 'all')
  const ticker = useIntervalFn(rebuild, WINDOW_TICK_MS, { immediate: false })
  watch(
    sliding,
    (active) => {
      if (active) ticker.resume()
      else ticker.pause()
    },
    { immediate: true }
  )

  return {
    fields,
    selection,
    series,
    rows,
    scalesDiffer: computed(() => scalesDiffer(rows.value.map((row) => row.stats))),
    windowEmpty: computed(() => rows.value.every((row) => row.stats.count === 0)),
    colorOf,
    toggle,
    canSelectMore: computed(() => selection.value.size < MAX_SERIES),
    coverage
  }
}
