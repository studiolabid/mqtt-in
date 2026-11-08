/**
 * Human-readable MQTT 5 intervals (seconds), e.g. for the session expiry presets.
 */
import { UINT32_MAX } from './validate'

const UNITS: ReadonlyArray<[seconds: number, singular: string, plural: string]> = [
  [86_400, 'day', 'days'],
  [3_600, 'hour', 'hours'],
  [60, 'minute', 'minutes'],
  [1, 'second', 'seconds']
]

/** `1 day 2 hours`, `45 seconds` (at most two units). */
export function humanizeSeconds(total: number): string {
  if (total <= 0) return '0 seconds'
  const parts: string[] = []
  let rest = Math.floor(total)
  for (const [size, singular, plural] of UNITS) {
    const count = Math.floor(rest / size)
    if (count === 0) continue
    parts.push(`${count} ${count === 1 ? singular : plural}`)
    rest -= count * size
    if (parts.length === 2) break
  }
  return parts.join(' ')
}

/** What a session expiry interval means for the user. */
export function describeSessionExpiry(value: number | undefined): string {
  if (value === undefined || value === 0) return 'The session ends when the connection closes.'
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) return ''
  if (value === UINT32_MAX) return 'The session never expires.'
  return `The broker keeps the session for ${humanizeSeconds(value)} after a disconnect.`
}
