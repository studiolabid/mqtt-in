/**
 * Best-effort JSON preferences in localStorage (layouts, collapsed groups…). Storage can be
 * unavailable (private mode, blocked, tests) or hold garbage: reads return `undefined`, writes
 * are dropped.
 */

export function readPreference(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : undefined
  } catch {
    return undefined
  }
}

export function writePreference(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // Unavailable or full: the preference is simply not remembered.
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `value` when it is a finite number, else `fallback`. */
export function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
