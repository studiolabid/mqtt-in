/**
 * Structured-clone friendly deep copies.
 *
 * Vue reactive proxies cannot cross the Electron IPC boundary ("An object could not be
 * cloned"). `toPlain` copies arrays and plain objects recursively (reading through proxies),
 * keeps binary data and primitives as they are and drops functions and `undefined` properties.
 */

/** Guards against cyclic structures, which never occur in domain data. */
const MAX_DEPTH = 64

/**
 * Returns a plain deep copy of `value` that is safe to send over IPC or persist.
 * Functions passed at the top level are returned unchanged (e.g. IPC listeners).
 *
 * @throws Error when the value is nested deeper than 64 levels (cyclic data).
 */
export function toPlain<T>(value: T): T {
  return copy(value, 0) as T
}

function copy(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value
  if (depth > MAX_DEPTH) throw new Error('Value is nested too deeply to be copied')
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value
  if (value instanceof Date) return new Date(value.getTime())
  if (Array.isArray(value)) return value.map((item) => copy(item, depth + 1))
  if (value instanceof Map) {
    return new Map(Array.from(value, ([key, item]) => [key, copy(item, depth + 1)]))
  }
  if (value instanceof Set) return new Set(Array.from(value, (item) => copy(item, depth + 1)))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === 'function') continue
    out[key] = copy(item, depth + 1)
  }
  return out
}
