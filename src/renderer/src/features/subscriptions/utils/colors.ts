/**
 * Colors of new subscriptions (pure). Every new subscription starts neutral gray (the
 * black-and-white default, ARCHITECTURE §5): vivid palette colors read as status (green looks
 * "connected") and are only handed out on request, by "Give each a distinct color" in Add
 * multiple.
 */
import { NEUTRAL_COLOR, PALETTE, pickColor } from '@shared/defaults'

/** The color of a new subscription, whatever colors the list already holds. */
export function defaultSubscriptionColor(): string {
  return NEUTRAL_COLOR
}

/** Position of a color in the palette (case-insensitive), or -1. */
export function paletteIndex(color: string): number {
  const hex = color.trim().toLowerCase()
  return PALETTE.findIndex((entry) => entry === hex)
}

/**
 * `count` colors starting at palette position `start`: unused colors first, then the palette
 * repeats once every color is taken.
 */
export function nextColors(
  count: number,
  taken: readonly string[],
  start = taken.length
): string[] {
  const used = new Set(taken.map((color) => color.trim().toLowerCase()))
  const colors: string[] = []
  for (let offset = 0; colors.length < count && offset < PALETTE.length; offset++) {
    const color = pickColor(start + offset)
    if (used.has(color)) continue
    used.add(color)
    colors.push(color)
  }
  for (let offset = 0; colors.length < count; offset++) colors.push(pickColor(start + offset))
  return colors
}

/**
 * Colors of the subscriptions created by Add multiple: the chosen color for every one, or with
 * `distinct` the chosen color first, then the palette colors that follow it and that the list
 * (`taken`) does not use yet.
 */
export function bulkColors(
  count: number,
  chosen: string,
  taken: readonly string[],
  distinct: boolean
): string[] {
  if (count <= 0) return []
  if (!distinct) return Array.from({ length: count }, () => chosen)
  const start = paletteIndex(chosen)
  return [
    chosen,
    ...nextColors(count - 1, [...taken, chosen], start === -1 ? taken.length + 1 : start + 1)
  ]
}
