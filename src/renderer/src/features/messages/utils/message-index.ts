/**
 * Id lookups in message lists (pure, no Vue).
 *
 * Message ids are monotonic per main process, so buffers and filtered rows are ascending by id
 * in the normal case: lookups are binary searches. `indexOfId` falls back to a scan when the
 * order assumption does not hold.
 */
import type { MqttMessage } from '@shared/models'

/** Index of the first row whose id is >= `id` (`rows.length` when there is none). */
export function lowerBoundById(rows: readonly MqttMessage[], id: number): number {
  let low = 0
  let high = rows.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (rows[mid].id < id) low = mid + 1
    else high = mid
  }
  return low
}

/** Number of rows whose id is <= `id` (= index of the first newer row). */
export function upperBoundById(rows: readonly MqttMessage[], id: number): number {
  let low = 0
  let high = rows.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (rows[mid].id <= id) low = mid + 1
    else high = mid
  }
  return low
}

/** Index of the row with `id`, or -1 (binary search, then a scan from the newest end). */
export function indexOfId(rows: readonly MqttMessage[], id: number): number {
  const index = lowerBoundById(rows, id)
  if (index < rows.length && rows[index].id === id) return index
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].id === id) return i
  return -1
}
