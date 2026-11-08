import uPlot from 'uplot'
import type { ChartSeries } from '@/types'
import { chartStructureKey } from './align'
import { buildChartOptions } from './options'
import { readChartTheme, resolveSeriesColors, rgba, type ChartTheme, type Rgba } from './theme'

/** Everything needed to draw one frame of the chart. */
export interface ChartFrame {
  /** Element that receives uPlot's DOM. */
  host: HTMLElement
  /** Element in whose context theme tokens (and the surface color) are resolved. */
  themeRoot: HTMLElement
  series: readonly ChartSeries[]
  data: uPlot.AlignedData
  width: number
  height: number
  hidden: ReadonlySet<string>
  yLabel?: string
}

export interface ChartEvents {
  /** Cursor moved: closest x index and per-series (nearest non-null) indexes; `null` = hidden. */
  cursor: (idx: number | null, idxs: ReadonlyArray<number | null>) => void
  /** The x scale became narrower than the data (user zoom) or was restored. */
  zoom: (zoomed: boolean) => void
}

function paletteKey(theme: ChartTheme, colors: readonly Rgba[]): string {
  return JSON.stringify([theme, colors.map((c) => rgba(c))])
}

/**
 * Owns the uPlot instance behind `TimeSeriesChart`. A new instance is only built when the
 * series structure or the resolved theme changes; otherwise data is streamed with `setData`,
 * keeping a user zoom window in place.
 */
export class TimeSeriesPlot {
  private plot: uPlot | null = null
  private structure = ''
  private palette = ''
  private zoomed = false

  constructor(private readonly events: ChartEvents) {}

  /** True while a uPlot instance exists. */
  get active(): boolean {
    return this.plot !== null
  }

  /** Creates the plot or updates its data. */
  render(frame: ChartFrame): void {
    const key = chartStructureKey(frame.series, frame.yLabel)
    if (this.plot && key === this.structure) this.update(this.plot, frame.data)
    else this.create(frame, key)
  }

  /** Rebuilds the plot when theme tokens or resolved series colors changed. */
  refreshTheme(frame: ChartFrame): void {
    if (!this.plot) return
    const theme = readChartTheme(frame.themeRoot)
    const colors = resolveSeriesColors(
      frame.themeRoot,
      frame.series.map((s) => s.color)
    )
    if (paletteKey(theme, colors) !== this.palette) {
      this.create(frame, chartStructureKey(frame.series, frame.yLabel))
    }
  }

  resize(width: number, height: number): void {
    this.plot?.setSize({ width, height })
  }

  /** Restores the full x range. */
  resetZoom(data: uPlot.AlignedData): void {
    if (!this.plot) return
    this.setZoomed(false)
    this.plot.setData(data)
  }

  setVisible(seriesIndex: number, visible: boolean): void {
    this.plot?.setSeries(seriesIndex + 1, { show: visible })
  }

  /** Index range of the data currently in view (respects zoom). */
  visibleRange(length: number): [number, number] {
    const idxs = this.plot?.series[0]?.idxs
    return idxs ? [idxs[0], idxs[1]] : [0, length - 1]
  }

  /** Puts the crosshair on an x value (keyboard inspection). */
  showCursorAt(x: number): void {
    const u = this.plot
    if (u) u.setCursor({ left: u.valToPos(x, 'x'), top: u.over.clientHeight / 2 })
  }

  hideCursor(): void {
    this.plot?.setCursor({ left: -10, top: -10 })
  }

  /** Re-measures axes, e.g. once web fonts have loaded. */
  redrawAxes(): void {
    this.plot?.redraw(false, true)
  }

  destroy(): void {
    this.plot?.destroy()
    this.plot = null
    this.structure = ''
    this.setZoomed(false)
    this.events.cursor(null, [])
  }

  private create(frame: ChartFrame, key: string): void {
    this.destroy()
    const theme = readChartTheme(frame.themeRoot)
    const colors = resolveSeriesColors(
      frame.themeRoot,
      frame.series.map((s) => s.color)
    )
    const options = buildChartOptions({
      width: frame.width,
      height: frame.height,
      series: frame.series,
      colors,
      hidden: frame.hidden,
      theme,
      yLabel: frame.yLabel,
      onCursor: (u) =>
        this.events.cursor(u.cursor.idx ?? null, u.cursor.idxs ? [...u.cursor.idxs] : []),
      onScale: (u, scaleKey) => this.onScale(u, scaleKey)
    })
    this.plot = new uPlot(options, frame.data, frame.host)
    this.structure = key
    this.palette = paletteKey(theme, colors)
  }

  private update(u: uPlot, data: uPlot.AlignedData): void {
    if (!this.zoomed) {
      u.setData(data)
      return
    }
    const { min, max } = u.scales.x
    u.setData(data, false)
    if (min !== undefined && max !== undefined) u.setScale('x', { min, max })
  }

  private onScale(u: uPlot, scaleKey: string): void {
    if (scaleKey !== 'x') return
    const xs = u.data[0]
    const { min, max } = u.scales.x
    this.setZoomed(
      xs.length > 1 && min !== undefined && max !== undefined
        ? min > xs[0] || max < xs[xs.length - 1]
        : false
    )
  }

  private setZoomed(zoomed: boolean): void {
    if (zoomed === this.zoomed) return
    this.zoomed = zoomed
    this.events.zoom(zoomed)
  }
}
