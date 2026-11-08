import { describe, expect, it, vi } from 'vitest'
import type uPlot from 'uplot'
import { formatMeasure, formatReadout } from '@/components/common/lib/chart/format'
import {
  buildChartOptions,
  MIN_RIGHT_PADDING,
  rightPadding,
  type ChartOptionsInput
} from '@/components/common/lib/chart/options'
import type { ChartTheme } from '@/components/common/lib/chart/theme'

/** Monospace stand-in for canvas measureText: 6.6 px per character. */
const measure = vi.fn((text: string) => text.length * 6.6)

const theme: ChartTheme = {
  surface: { r: 255, g: 255, b: 255, a: 1 },
  text: { r: 0, g: 0, b: 0, a: 1 },
  grid: { r: 200, g: 200, b: 200, a: 1 },
  axis: { r: 150, g: 150, b: 150, a: 1 },
  fontMono: 'Geist Mono',
  fontSans: 'Geist'
}

function options(overrides: Partial<ChartOptionsInput> = {}): uPlot.Options {
  return buildChartOptions({
    width: 400,
    height: 200,
    series: [{ name: 't', color: '#f00', points: [] }],
    colors: [{ r: 255, g: 0, b: 0, a: 1 }],
    hidden: new Set(),
    theme,
    onCursor: () => undefined,
    onScale: () => undefined,
    measureText: measure,
    ...overrides
  })
}

const fakePlot = {} as uPlot

describe('chart right padding (no clipped last tick label)', () => {
  it('reserves half of the last label (centred on its tick) plus 2 px, at least 14 px', () => {
    const width = measure('08:55:10')
    expect(rightPadding('08:55:10', '11px mono', measure)).toBeGreaterThanOrEqual(width / 2)
    expect(rightPadding('08:55:10', '11px mono', measure)).toBe(Math.ceil(width / 2) + 2)
    expect(rightPadding('8', '11px mono', measure)).toBe(MIN_RIGHT_PADDING)
    expect(rightPadding(null, '11px mono', measure)).toBe(MIN_RIGHT_PADDING)
  })

  it('measures the last x tick label of the current layout cycle with the axis font', () => {
    const opts = options()
    const pad = opts.padding?.[1]
    const xValues = opts.axes?.[0].values
    if (typeof pad !== 'function' || typeof xValues !== 'function') {
      throw new Error('expected a padding function and an x tick formatter')
    }
    // Before the axes are laid out: the minimum.
    expect(pad(fakePlot, 1, [false, false, true, true], 0)).toBe(MIN_RIGHT_PADDING)
    const at = new Date(2026, 10, 8, 8, 55, 10).getTime()
    const labels = xValues(fakePlot, [at - 20_000, at - 10_000, at], 0, 84, 10_000)
    expect(labels.at(-1)).toBe('08:55:10')
    const labelWidth = '08:55:10'.length * 6.6
    const padding = pad(fakePlot, 1, [false, false, true, true], 1)
    expect(measure).toHaveBeenLastCalledWith('08:55:10', '11px Geist Mono')
    expect(padding).toBeGreaterThanOrEqual(labelWidth / 2)
    // Other sides keep their fixed values.
    expect(opts.padding?.[0]).toBe(10)
    expect(opts.padding?.[3]).toBe(2)
  })
})

describe('formatMeasure (one formatter for legend and stats, CT-21)', () => {
  const format = (digits: number, compact = false): Intl.NumberFormat =>
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: digits,
      notation: compact ? 'compact' : 'standard'
    })

  it("follows the legend's precision rule", () => {
    expect(formatMeasure(1234.567)).toBe(format(2).format(1234.567))
    expect(formatMeasure(23.4567)).toBe(format(3).format(23.4567))
    expect(formatMeasure(0.012345)).toBe(format(4).format(0.012345))
    expect(formatMeasure(1234567.891)).toBe(format(2).format(1234567.891))
    expect(formatReadout(1234.567)).toBe(formatMeasure(1234.567))
  })

  it('writes millions compactly on request, with the same 2 decimals', () => {
    expect(formatMeasure(1234567.891, { compact: true })).toBe(format(2, true).format(1234567.891))
    // Below a million compact changes nothing.
    expect(formatMeasure(1234.567, { compact: true })).toBe(formatMeasure(1234.567))
  })

  it('shows a dash for missing values', () => {
    expect(formatMeasure(null)).toBe('—')
    expect(formatMeasure(undefined)).toBe('—')
    expect(formatMeasure(Number.NaN, { compact: true })).toBe('—')
  })
})
