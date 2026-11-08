/**
 * Numeric series of a topic for the chart tab (pure, no Vue).
 *
 * Extraction (`extractNumbers`) is cached per message in a WeakMap, so re-deriving the series
 * after every throttled history update only parses the payloads that are new.
 */
import type { MqttMessage } from '@shared/models'
import { extractNumbers } from '@/utils/numeric'

/** Most numeric fields offered for one topic (payloads with varying schemas add up). */
export const MAX_CHART_FIELDS = 48

/** Ratio between the largest and smallest series magnitude above which a split view helps. */
const SCALE_RATIO_HINT = 25

const extracted = new WeakMap<MqttMessage, Readonly<Record<string, number>> | null>()

export const CHART_WINDOWS = [
  { id: '1m', label: '1m', ms: 60_000, title: 'Last minute', phrase: 'in the last minute' },
  {
    id: '5m',
    label: '5m',
    ms: 5 * 60_000,
    title: 'Last 5 minutes',
    phrase: 'in the last 5 minutes'
  },
  {
    id: '15m',
    label: '15m',
    ms: 15 * 60_000,
    title: 'Last 15 minutes',
    phrase: 'in the last 15 minutes'
  },
  { id: 'all', label: 'All', ms: Number.POSITIVE_INFINITY, title: 'Whole history', phrase: 'yet' }
] as const

export type ChartWindowId = (typeof CHART_WINDOWS)[number]['id']
export type ChartWindow = (typeof CHART_WINDOWS)[number]

export function chartWindow(id: ChartWindowId): ChartWindow {
  return CHART_WINDOWS.find((entry) => entry.id === id) ?? CHART_WINDOWS[CHART_WINDOWS.length - 1]
}

export function isChartWindowId(value: unknown): value is ChartWindowId {
  return CHART_WINDOWS.some((entry) => entry.id === value)
}

/** Numbers of a message payload (`extractNumbers`), cached per message. */
export function numbersOf(message: MqttMessage): Readonly<Record<string, number>> | null {
  let values = extracted.get(message)
  if (values === undefined) {
    values = extractNumbers(message.payload)
    extracted.set(message, values)
  }
  return values
}

/** Numeric fields found in the messages, in first-seen order (oldest message first). */
export function discoverFields(
  messages: readonly MqttMessage[],
  limit: number = MAX_CHART_FIELDS
): string[] {
  const seen = new Set<string>()
  for (const message of messages) {
    const values = numbersOf(message)
    if (!values) continue
    for (const key of Object.keys(values)) {
      if (seen.has(key)) continue
      seen.add(key)
      if (seen.size >= limit) return Array.from(seen)
    }
  }
  return Array.from(seen)
}

export interface FieldStats {
  count: number
  last: number | null
  min: number | null
  max: number | null
  avg: number | null
}

export interface FieldData {
  field: string
  /** `[epochMs, value]` in arrival order (a new array on every build). */
  points: Array<[number, number]>
  stats: FieldStats
}

/**
 * Points and statistics of `fields` for the messages received at or after `since` (messages
 * are in arrival order, so the window is a suffix of the history).
 */
export function buildFieldData(
  messages: readonly MqttMessage[],
  fields: readonly string[],
  since: number
): FieldData[] {
  let start = messages.length
  while (start > 0 && messages[start - 1].timestamp >= since) start--

  const points = fields.map((): Array<[number, number]> => [])
  for (let i = start; i < messages.length; i++) {
    const message = messages[i]
    const values = numbersOf(message)
    if (!values) continue
    for (let f = 0; f < fields.length; f++) {
      const value = values[fields[f]]
      if (typeof value === 'number') points[f].push([message.timestamp, value])
    }
  }
  return fields.map((field, f) => ({ field, points: points[f], stats: statsOf(points[f]) }))
}

function statsOf(points: ReadonlyArray<readonly [number, number]>): FieldStats {
  if (points.length === 0) return { count: 0, last: null, min: null, max: null, avg: null }
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  for (const [, value] of points) {
    if (value < min) min = value
    if (value > max) max = value
    sum += value
  }
  return {
    count: points.length,
    last: points[points.length - 1][1],
    min,
    max,
    avg: sum / points.length
  }
}

/**
 * True when the series magnitudes are so different that one shared y-axis flattens the small
 * ones (e.g. a 0/1 flag next to a pressure around 1013).
 */
export function scalesDiffer(stats: readonly FieldStats[]): boolean {
  const magnitudes: number[] = []
  for (const s of stats) {
    if (s.min === null || s.max === null) continue
    const magnitude = Math.max(Math.abs(s.min), Math.abs(s.max), Math.abs(s.max - s.min))
    if (magnitude > 0) magnitudes.push(magnitude)
  }
  if (magnitudes.length < 2) return false
  return Math.max(...magnitudes) / Math.min(...magnitudes) > SCALE_RATIO_HINT
}
