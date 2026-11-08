/**
 * Small helpers to inspect unknown thrown values without `any`.
 */

/** The message of an Error-like value (or its string form). */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (isRecord(err) && typeof err.message === 'string') return err.message
  return String(err)
}

/**
 * The string `code` of a Node / OpenSSL error (`ECONNREFUSED`, `CERT_HAS_EXPIRED`…).
 * Looks into the first inner error of an `AggregateError` (Node's happy-eyeballs connect).
 */
export function errorCode(err: unknown): string | undefined {
  if (!isRecord(err)) return undefined
  if (typeof err.code === 'string' && err.code.length > 0) return err.code
  if (Array.isArray(err.errors) && err.errors.length > 0) return errorCode(err.errors[0])
  return undefined
}

/** The numeric `code` of an mqtt.js `ErrorWithReasonCode`. */
export function reasonCodeOf(err: unknown): number | undefined {
  return isRecord(err) && typeof err.code === 'number' ? err.code : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
