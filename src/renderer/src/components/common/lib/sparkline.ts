/** SVG geometry for a sparkline. Paths are empty strings when there is nothing to draw. */
export interface SparklineGeometry {
  /** Polyline path (`M x y L …`). */
  line: string
  /** Closed area path under the line, down to the bottom edge. */
  area: string
  /** Position of the latest value (end dot), or `null` without data. */
  last: { x: number; y: number } | null
}

const EMPTY: SparklineGeometry = { line: '', area: '', last: null }

const round = (n: number): number => Math.round(n * 100) / 100

/**
 * Keeps the visual envelope of long series: one min and one max per bucket, in their
 * original order, so a 64 px sparkline never draws thousands of points.
 */
export function downsample(values: readonly number[], buckets: number): number[] {
  if (values.length <= buckets * 2) return values.slice()
  const out: number[] = []
  const size = values.length / buckets
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size)
    const end = Math.min(values.length, Math.floor((b + 1) * size))
    let minIdx = start
    let maxIdx = start
    for (let i = start + 1; i < end; i++) {
      if (values[i] < values[minIdx]) minIdx = i
      if (values[i] > values[maxIdx]) maxIdx = i
    }
    if (minIdx === maxIdx) out.push(values[minIdx])
    else if (minIdx < maxIdx) out.push(values[minIdx], values[maxIdx])
    else out.push(values[maxIdx], values[minIdx])
  }
  return out
}

/**
 * Computes line / area paths for `values` inside a `width × height` box with `pad` px of
 * vertical breathing room. Non-finite values are ignored; a single value or constant data
 * draws a flat line through the middle.
 */
export function sparklineGeometry(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2
): SparklineGeometry {
  if (!(width > 0) || !(height > 0)) return EMPTY
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return EMPTY

  const points = downsample(finite, Math.max(1, Math.floor(width)))
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min
  const inner = Math.max(0, height - pad * 2)
  const y = (v: number): number =>
    round(span === 0 ? height / 2 : pad + (1 - (v - min) / span) * inner)
  const edge = Math.min(pad, width / 4)

  const coords =
    points.length === 1
      ? [
          { x: round(edge), y: y(points[0]) },
          { x: round(width - edge), y: y(points[0]) }
        ]
      : points.map((v, i) => ({
          x: round(edge + (i / (points.length - 1)) * (width - edge * 2)),
          y: y(v)
        }))

  const line = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
  const first = coords[0]
  const last = coords[coords.length - 1]
  const area = `${line} L${last.x} ${height} L${first.x} ${height} Z`
  return { line, area, last }
}
