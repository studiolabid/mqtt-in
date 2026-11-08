import type uPlot from 'uplot'
import type { ChartSeries } from '@/types'

type Point = readonly [number, number]

/** Finite points in ascending time order (input is trusted when already clean). */
function sanitize(points: readonly Point[]): readonly Point[] {
  let clean = true
  let sorted = true
  for (let i = 0; i < points.length; i++) {
    const [t, v] = points[i]
    if (!Number.isFinite(t) || !Number.isFinite(v)) clean = false
    else if (i > 0 && t < points[i - 1][0]) sorted = false
  }
  if (clean && sorted) return points
  return points
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0])
}

/**
 * Merges series with independent timestamps onto one shared, strictly ascending x axis
 * (uPlot "aligned" data). Samples missing from a series at a given x are `null` (drawn with
 * `spanGaps`), non-finite values are dropped and duplicate timestamps keep the last value.
 */
export function alignSeries(series: readonly ChartSeries[]): uPlot.AlignedData {
  const lists = series.map((s) => sanitize(s.points))
  const cursors = lists.map(() => 0)
  const xs: number[] = []
  const ys: Array<Array<number | null>> = lists.map(() => [])

  for (;;) {
    let next = Infinity
    for (let s = 0; s < lists.length; s++) {
      const point = lists[s][cursors[s]]
      if (point && point[0] < next) next = point[0]
    }
    if (next === Infinity) break
    xs.push(next)
    for (let s = 0; s < lists.length; s++) {
      const list = lists[s]
      let i = cursors[s]
      let value: number | null = null
      while (i < list.length && list[i][0] === next) {
        value = list[i][1]
        i++
      }
      cursors[s] = i
      ys[s].push(value)
    }
  }
  return [xs, ...ys]
}

/** Changes of this key require a new uPlot instance (series count / names / colors / label). */
export function chartStructureKey(series: readonly ChartSeries[], yLabel = ''): string {
  return JSON.stringify([yLabel, series.map((s) => [s.name, s.color])])
}

export interface SeriesSummary {
  name: string
  count: number
  min: number | null
  max: number | null
  /** Latest finite sample. */
  last: Point | null
}

/** Count / min / max / latest per series (for accessible descriptions and idle readouts). */
export function summarizeSeries(series: readonly ChartSeries[]): SeriesSummary[] {
  return series.map((s) => {
    let min = Infinity
    let max = -Infinity
    let last: Point | null = null
    let count = 0
    for (const point of s.points) {
      const [t, v] = point
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue
      count++
      if (v < min) min = v
      if (v > max) max = v
      if (!last || t >= last[0]) last = point
    }
    return {
      name: s.name,
      count,
      min: count ? min : null,
      max: count ? max : null,
      last
    }
  })
}
