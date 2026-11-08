/**
 * The error of invalid authored payload input. Pure, works in every process.
 */

/** Invalid authored input (bad hex, base64, JSON…). `message` is short and user friendly. */
export class PayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayloadError'
  }
}

/** The message of a thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
