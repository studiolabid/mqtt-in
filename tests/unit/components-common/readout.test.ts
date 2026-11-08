import { describe, expect, it } from 'vitest'
import { alignSeries, summarizeSeries } from '@/components/common/lib/chart/align'
import { announceLegend, buildLegend, describeChart } from '@/components/common/lib/chart/readout'
import type { ChartSeries } from '@/types'

const series: ChartSeries[] = [
  {
    name: 'a',
    color: '#f00',
    points: [
      [1000, 1],
      [3000, 3]
    ]
  },
  { name: 'b', color: '#0f0', points: [[2000, 20]] }
]
const base = {
  series,
  summaries: summarizeSeries(series),
  data: alignSeries(series),
  hidden: new Set<string>(),
  now: 3000
}

describe('chart readout', () => {
  it('shows the latest sample of every series when idle', () => {
    const legend = buildLegend({ ...base, cursorIdx: null, cursorIdxs: [] })
    expect(legend.live).toBe(false)
    expect(legend.items.map((i) => i.value)).toEqual(['3', '20'])
    expect(legend.time).toMatch(/\d{2}:\d{2}:03\.000$/)
  })

  it('shows values at the cursor (per-series indexes) while hovering', () => {
    const legend = buildLegend({ ...base, cursorIdx: 1, cursorIdxs: [1, 0, 1] })
    expect(legend.live).toBe(true)
    expect(legend.items.map((i) => i.value)).toEqual(['1', '20'])
    expect(legend.time).toMatch(/:02\.000$/)
  })

  it('marks hidden series and missing values', () => {
    const legend = buildLegend({
      ...base,
      hidden: new Set(['b']),
      cursorIdx: 0,
      cursorIdxs: [0, 0, null]
    })
    expect(legend.items[1]).toMatchObject({ off: true, value: '—' })
    expect(announceLegend(legend, true)).toMatch(/: a 1, b —$/)
  })

  it('describes the data for assistive tech', () => {
    expect(describeChart(base.summaries, 'No data')).toMatch(/a: 2 points, latest 3, min 1, max 3/)
    expect(describeChart(summarizeSeries([]), 'No data')).toBe('No data')
  })
})
