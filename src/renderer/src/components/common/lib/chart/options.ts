import type uPlot from 'uplot'
import type { ChartSeries } from '@/types'
import { formatNumberTicks, formatTimeTick, TIME_INCRS } from './format'
import { rgba, type ChartTheme, type Rgba } from './theme'

export interface ChartOptionsInput {
  width: number
  height: number
  series: readonly ChartSeries[]
  /** Resolved stroke colors, index-aligned with `series`. */
  colors: readonly Rgba[]
  /** Names of series toggled off in the legend. */
  hidden: ReadonlySet<string>
  theme: ChartTheme
  yLabel?: string
  onCursor: (u: uPlot) => void
  onScale: (u: uPlot, scaleKey: string) => void
  /** Text width in px for a CSS font (default: canvas `measureText`; injectable for tests). */
  measureText?: TextMeasure
}

export type TextMeasure = (text: string, font: string) => number

const FONT_SIZE = 11
const LINE_WIDTH = 1.5
/** Single points / brief gaps are shown ±30 s around the sample. */
const SINGLE_POINT_SPAN = 30_000
/** Shorter bursts are widened to this span, so the time axis always has whole-second ticks. */
const MIN_SPAN = 3_000
/** Smallest right padding, in px. */
export const MIN_RIGHT_PADDING = 14

let measureCtx: CanvasRenderingContext2D | null | undefined

function textWidth(text: string, font: string): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * FONT_SIZE * 0.62
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

/**
 * Right padding that keeps the last x tick label inside the canvas: labels are centered on
 * their tick, so half of the label may extend past the plot area (`max(14, ⌈width / 2⌉ + 2)`).
 */
export function rightPadding(
  lastLabel: string | null,
  font: string,
  measure: TextMeasure = textWidth
): number {
  if (!lastLabel) return MIN_RIGHT_PADDING
  return Math.max(MIN_RIGHT_PADDING, Math.ceil(measure(lastLabel, font) / 2) + 2)
}

/** Y-axis width that fits the widest tick label (computed once per layout cycle). */
function yAxisSize(font: string): uPlot.Axis.Size {
  let last = 0
  return (_u, values, _axisIdx, cycleNum) => {
    if (cycleNum > 1 && last > 0) return last
    const widest = (values ?? []).reduce((max, v) => Math.max(max, textWidth(String(v), font)), 0)
    last = Math.max(24, Math.ceil(widest) + 14)
    return last
  }
}

/** A soft vertical wash under a single series (fades out toward the baseline). */
function areaFill(color: Rgba): uPlot.Series.Fill {
  return (u) => {
    const { top, height } = u.bbox
    const gradient = u.ctx.createLinearGradient(0, top, 0, top + height)
    gradient.addColorStop(0, rgba(color, 0.16))
    gradient.addColorStop(1, rgba(color, 0.01))
    return gradient
  }
}

/** uPlot options for `TimeSeriesChart` (x = epoch ms in local time, one shared y scale). */
export function buildChartOptions(input: ChartOptionsInput): uPlot.Options {
  const { theme, colors } = input
  const single = input.series.length === 1
  const mono = `${FONT_SIZE}px ${theme.fontMono}`
  const surface = rgba(theme.surface, 1)
  const measure = input.measureText ?? textWidth
  /** The last x tick label of the current layout cycle (uPlot computes axes before padding). */
  let lastXLabel: string | null = null

  const series: uPlot.Series[] = input.series.map((s, i) => ({
    label: s.name,
    show: !input.hidden.has(s.name),
    stroke: rgba(colors[i]),
    width: LINE_WIDTH,
    spanGaps: true,
    fill: single ? areaFill(colors[i]) : undefined,
    fillTo: (u) => u.scales.y?.min ?? 0,
    points: { size: 7, width: 2, stroke: surface, fill: rgba(colors[i]) }
  }))

  return {
    width: input.width,
    height: input.height,
    ms: 1,
    padding: [10, () => rightPadding(lastXLabel, mono, measure), 0, 2],
    legend: { show: false },
    cursor: {
      x: true,
      y: false,
      drag: { x: true, y: false, setScale: true, dist: 8 },
      hover: { skip: [null, undefined], prox: null },
      points: {
        size: 12,
        width: 2,
        stroke: () => surface,
        fill: (_u, seriesIdx) => rgba(colors[seriesIdx - 1] ?? theme.text)
      }
    },
    scales: {
      x: {
        time: true,
        range: (u, min, max) => {
          const xs = u.data[0]
          if (xs.length === 1) return [xs[0] - SINGLE_POINT_SPAN, xs[0] + SINGLE_POINT_SPAN]
          if (max - min >= MIN_SPAN) return [min, max]
          const pad = (MIN_SPAN - (max - min)) / 2
          return [min - pad, max + pad]
        }
      },
      y: { auto: true }
    },
    axes: [
      {
        stroke: rgba(theme.text),
        font: mono,
        size: 28,
        gap: 6,
        space: 84,
        incrs: TIME_INCRS,
        values: (_u, splits, _axisIdx, _space, incr) => {
          const labels = splits.map((v) =>
            v === null || v === undefined ? null : formatTimeTick(v, incr)
          )
          lastXLabel = null
          for (let i = labels.length - 1; i >= 0 && lastXLabel === null; i--) lastXLabel = labels[i]
          return labels
        },
        grid: { show: false },
        ticks: { show: true, stroke: rgba(theme.axis), width: 1, size: 4 },
        border: { show: true, stroke: rgba(theme.axis), width: 1 }
      },
      {
        stroke: rgba(theme.text),
        font: mono,
        gap: 8,
        space: 30,
        size: yAxisSize(mono),
        values: (_u, splits, _axisIdx, _space, incr) => formatNumberTicks(splits, incr),
        grid: { show: true, stroke: rgba(theme.grid), width: 1 },
        ticks: { show: false },
        label: input.yLabel || undefined,
        labelFont: `${FONT_SIZE}px ${theme.fontSans}`,
        labelSize: input.yLabel ? 16 : 0,
        labelGap: 0
      }
    ],
    series: [{}, ...series],
    hooks: {
      setCursor: [input.onCursor],
      setScale: [input.onScale]
    }
  }
}
