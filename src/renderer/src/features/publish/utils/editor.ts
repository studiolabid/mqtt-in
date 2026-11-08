/**
 * Payload editor helpers of the publish panel.
 */

/**
 * The arguments of a `{{fn(a,b)}}` template token (offsets inside the token), selected after
 * insertion so they can be typed over; `undefined` when the token takes no arguments.
 */
export function tokenArguments(token: string): { from: number; to: number } | undefined {
  const open = token.indexOf('(')
  const close = token.lastIndexOf(')')
  return open !== -1 && close > open + 1 ? { from: open + 1, to: close } : undefined
}
