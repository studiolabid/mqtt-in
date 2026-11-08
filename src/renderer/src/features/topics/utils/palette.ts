/**
 * Categorical series colors for topic charts (pure).
 *
 * The dataviz reference palette: eight hues in a fixed order (the order is the color-vision
 * safety mechanism, never reshuffle it), with separate steps for light and dark surfaces.
 * Validated with the dataviz checker against mqtey's surfaces (light #ffffff / #fafafb, dark
 * #09090b / #121215): every adjacent pair clears CVD ΔE 8.4 and normal-vision ΔE 19.3. Three
 * light steps (aqua, yellow, magenta) sit below 3:1 on white, so every chart ships a values
 * table next to it (the relief channel).
 *
 * Colors follow the field, never its rank: a field keeps its slot while it stays selected, and
 * a ninth series is never generated (selection is capped at `MAX_SERIES`).
 */

const LIGHT = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#6250d6', // violet
  '#e34948' // red
] as const

const DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767'
] as const

/** Series that can be shown at once (one per palette slot). */
export const MAX_SERIES = LIGHT.length

/** Color of a palette slot for the current theme (out-of-range slots are clamped). */
export function seriesColor(slot: number, dark: boolean): string {
  const palette = dark ? DARK : LIGHT
  const index = Number.isFinite(slot) ? Math.min(palette.length - 1, Math.max(0, slot)) : 0
  return palette[Math.floor(index)]
}

/** Lowest slot that is not in use, or `null` when every slot is taken. */
export function freeSlot(used: Iterable<number>): number | null {
  const taken = new Set(used)
  for (let slot = 0; slot < MAX_SERIES; slot++) if (!taken.has(slot)) return slot
  return null
}
