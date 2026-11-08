import type uPlot from 'uplot'
import type { ChartSeries } from '@/types'
import type { SeriesSummary } from './align'
import { formatReadout, formatReadoutTime } from './format'

export interface LegendItem {
  name: string
  /** The series color as given (CSS), for the line key. */
  color: string
  /** Formatted value (`—` when missing). */
  value: string
  /** Toggled off by the user. */
  off: boolean
}

export interface Legend {
  /** True while showing values at the cursor (hover / keyboard). */
  live: boolean
  /** Formatted time of the shown values (empty without data). */
  time: string
  items: LegendItem[]
}

export interface LegendInput {
  series: readonly ChartSeries[]
  summaries: readonly SeriesSummary[]
  data: uPlot.AlignedData | null
  /** Closest x index of the cursor, `null` when hidden. */
  cursorIdx: number | null
  /** Per-series indexes from uPlot (index 0 = x), nearest non-null sample. */
  cursorIdxs: ReadonlyArray<number | null>
  hidden: ReadonlySet<string>
  now?: number
}

/** Legend readout: values at the cursor, otherwise the latest sample of every series. */
export function buildLegend(input: LegendInput): Legend {
  const { data, cursorIdx } = input
  const hover =
    data !== null && cursorIdx !== null && cursorIdx < data[0].length
      ? { data, idx: cursorIdx }
      : null
  let time = -Infinity
  const items = input.series.map((s, i): LegendItem => {
    let value: number | null | undefined = null
    if (hover) {
      const j = input.cursorIdxs[i + 1]
      if (j !== null && j !== undefined) value = hover.data[i + 1]?.[j]
    } else {
      const last = input.summaries[i]?.last
      if (last) {
        value = last[1]
        time = Math.max(time, last[0])
      }
    }
    return {
      name: s.name,
      color: s.color,
      value: formatReadout(value),
      off: input.hidden.has(s.name)
    }
  })
  if (hover) time = hover.data[0][hover.idx]
  return {
    live: hover !== null,
    items,
    time: Number.isFinite(time) ? formatReadoutTime(time, input.now) : ''
  }
}

/** Accessible description of the chart (series, sample counts, latest / min / max). */
export function describeChart(summaries: readonly SeriesSummary[], emptyText: string): string {
  const parts = summaries
    .filter((s) => s.count > 0)
    .map(
      (s) =>
        `${s.name}: ${s.count} points, latest ${formatReadout(s.last?.[1])}, ` +
        `min ${formatReadout(s.min)}, max ${formatReadout(s.max)}`
    )
  if (parts.length === 0) return emptyText
  return `Time series chart. ${parts.join('. ')}. Use the arrow keys to inspect values.`
}

/** Text announced while inspecting with the keyboard. */
export function announceLegend(legend: Legend, withNames: boolean): string {
  const values = legend.items.map((item) => (withNames ? `${item.name} ${item.value}` : item.value))
  return `${legend.time}: ${values.join(', ')}`
}
