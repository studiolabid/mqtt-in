/**
 * Text helpers for files written by other programs.
 */

const BYTE_ORDER_MARK = 0xfeff

/** Removes a leading UTF-8 byte order mark (files saved by some Windows editors). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text
}
