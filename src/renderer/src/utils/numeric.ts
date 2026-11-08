/**
 * Numeric value extraction for topic charts and pinned values (pure, no Vue).
 */
import { utf8Decode } from '@shared/payload'

export const NUMERIC_LIMITS = {
  /** Maximum number of path segments (`a.b.c.d.e`). */
  maxDepth: 5,
  /** Maximum number of extracted fields per payload. */
  maxFields: 24,
  /** Larger payloads are not parsed (keeps chart updates cheap). */
  maxBytes: 64 * 1024
} as const

/** Plain decimal number (no hex, no Infinity / NaN, no surrounding garbage). */
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * Pin field of a payload that is only a number (`23.5`, `true`): see `numericValue`.
 * (`extractNumbers` reports such a payload as the field `value`, like `{"value": 23.5}`.)
 */
export const BARE_NUMBER_FIELD = ''

/** The value of a trimmed text that is a plain number or `true` / `false`, else null. */
function scalarOf(text: string): number | null {
  if (NUMBER_RE.test(text)) {
    const value = Number(text)
    return Number.isFinite(value) ? value : null
  }
  const lower = text.toLowerCase()
  if (lower === 'true') return 1
  if (lower === 'false') return 0
  return null
}

/** The value of a payload that is only a number (or `true` / `false`), else null. */
export function bareNumber(payload: Uint8Array): number | null {
  if (payload.length === 0 || payload.length > NUMERIC_LIMITS.maxBytes) return null
  const text = utf8Decode(payload).trim()
  return text.length === 0 ? null : scalarOf(text)
}

/**
 * One numeric field of a payload: `BARE_NUMBER_FIELD` (`''`) reads a bare-number payload,
 * any other field a key of `extractNumbers` (`value`, `a.b`, `arr.0`…). Null when missing.
 */
export function numericValue(payload: Uint8Array, field: string): number | null {
  if (field === BARE_NUMBER_FIELD) return bareNumber(payload)
  const values = extractNumbers(payload)
  return values && Object.hasOwn(values, field) ? values[field] : null
}

/**
 * Extracts chartable numbers from a payload:
 * - numeric text (`23.5`) → `{ value: 23.5 }`
 * - `true` / `false` (any case) → `{ value: 1 }` / `{ value: 0 }`
 * - JSON object / array → flattened dot paths (`a.b`, `arr.0`) of finite numbers and booleans,
 *   at most 5 levels deep and 24 fields
 *
 * @returns the extracted values, or `null` when the payload holds no numbers.
 */
export function extractNumbers(payload: Uint8Array): Record<string, number> | null {
  if (payload.length === 0 || payload.length > NUMERIC_LIMITS.maxBytes) return null
  const text = utf8Decode(payload).trim()
  if (text.length === 0) return null

  const scalar = scalarOf(text)
  if (scalar !== null) return { value: scalar }

  const first = text[0]
  if (first !== '{' && first !== '[') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  const fields = new Map<string, number>()
  collect(parsed, '', 0, fields)
  // Object.fromEntries defines own properties, so keys such as `__proto__` are safe.
  return fields.size > 0 ? Object.fromEntries(fields) : null
}

function collect(value: unknown, path: string, depth: number, out: Map<string, number>): void {
  if (out.size >= NUMERIC_LIMITS.maxFields) return
  if (typeof value === 'number') {
    if (path && Number.isFinite(value)) out.set(path, value)
    return
  }
  if (typeof value === 'boolean') {
    if (path) out.set(path, value ? 1 : 0)
    return
  }
  if (value === null || typeof value !== 'object' || depth >= NUMERIC_LIMITS.maxDepth) return

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, index): [string, unknown] => [String(index), item])
    : Object.entries(value)
  for (const [key, item] of entries) {
    if (out.size >= NUMERIC_LIMITS.maxFields) return
    collect(item, path ? `${path}.${key}` : key, depth + 1, out)
  }
}
