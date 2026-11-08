/**
 * Sidebar reordering helpers (pure).
 */

export type DropPosition = 'before' | 'after'

/** `order` with `id` moved right before / after `targetId` (unchanged copy when not possible). */
export function moveId(
  order: readonly string[],
  id: string,
  targetId: string,
  position: DropPosition
): string[] {
  if (id === targetId || !order.includes(id)) return [...order]
  const rest = order.filter((other) => other !== id)
  const index = rest.indexOf(targetId)
  if (index === -1) return [...order]
  rest.splice(position === 'before' ? index : index + 1, 0, id)
  return rest
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}
