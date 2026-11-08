/**
 * Resolves theme tokens to concrete canvas colors. uPlot paints on a canvas, which cannot
 * read CSS variables, so colors are computed from the DOM (in the context of the chart
 * element) and normalized to RGBA by painting them on a 1×1 canvas.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0–1 */
  a: number
}

export interface ChartTheme {
  /** Opaque color behind the chart (used for marker rings). */
  surface: Rgba
  /** Axis labels. */
  text: Rgba
  /** Hairline grid. */
  grid: Rgba
  /** Axis baseline, one step stronger than the grid. */
  axis: Rgba
  fontMono: string
  fontSans: string
}

const FALLBACK: Rgba = { r: 128, g: 128, b: 128, a: 1 }
const SENTINEL = '#010203'

let paint: CanvasRenderingContext2D | null | undefined

function paintContext(): CanvasRenderingContext2D | null {
  if (paint === undefined) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    paint = canvas.getContext('2d', { willReadFrequently: true })
  }
  return paint
}

/** Converts a computed CSS color string to RGBA, or `null` when the canvas rejects it. */
export function toRgba(color: string): Rgba | null {
  const ctx = paintContext()
  if (!ctx || !color) return null
  ctx.fillStyle = SENTINEL
  ctx.fillStyle = color
  if (ctx.fillStyle === SENTINEL && color.toLowerCase() !== SENTINEL) return null
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return { r, g, b, a: a / 255 }
}

/** `rgba(…)` string, optionally overriding the alpha. */
export function rgba(color: Rgba, alpha = color.a): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.round(alpha * 1000) / 1000})`
}

/**
 * Returns a resolver for CSS color expressions (`#hex`, `var(--token)`, `color-mix(…)`)
 * evaluated inside `el`, so inherited custom properties apply. Call `dispose()` when done.
 */
function colorResolver(el: HTMLElement): {
  resolve: (css: string) => Rgba | null
  dispose: () => void
} {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  el.appendChild(probe)
  return {
    resolve(css: string): Rgba | null {
      probe.style.color = ''
      probe.style.color = css
      if (!probe.style.color) return null
      return toRgba(getComputedStyle(probe).color)
    },
    dispose: () => probe.remove()
  }
}

/** First opaque background found walking up from `el` (the surface the chart sits on). */
function surfaceOf(el: HTMLElement): Rgba | null {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const color = toRgba(getComputedStyle(node).backgroundColor)
    if (color && color.a >= 0.95) return color
  }
  return null
}

function monoFontFamily(el: HTMLElement): string {
  const probe = document.createElement('span')
  probe.className = 'font-mono'
  probe.style.display = 'none'
  el.appendChild(probe)
  const family = getComputedStyle(probe).fontFamily
  probe.remove()
  return family || 'ui-monospace, monospace'
}

/** Reads the current theme colors and fonts for a chart mounted in `el`. */
export function readChartTheme(el: HTMLElement): ChartTheme {
  const { resolve, dispose } = colorResolver(el)
  try {
    return {
      surface: surfaceOf(el) ?? resolve('var(--background)') ?? FALLBACK,
      text: resolve('var(--muted-foreground)') ?? FALLBACK,
      grid: resolve('var(--border)') ?? FALLBACK,
      axis: resolve('color-mix(in oklab, var(--muted-foreground) 40%, transparent)') ?? FALLBACK,
      fontMono: monoFontFamily(el),
      fontSans: getComputedStyle(el).fontFamily || 'system-ui, sans-serif'
    }
  } finally {
    dispose()
  }
}

/** Resolves user / token series colors (unknown values fall back to `--primary`). */
export function resolveSeriesColors(el: HTMLElement, colors: readonly string[]): Rgba[] {
  const { resolve, dispose } = colorResolver(el)
  try {
    const primary = resolve('var(--primary)') ?? FALLBACK
    return colors.map((color) => resolve(color) ?? primary)
  } finally {
    dispose()
  }
}

/** Stable identity of a theme, to detect real changes. */
export function themeKey(theme: ChartTheme | null): string {
  return theme ? JSON.stringify(theme) : ''
}
