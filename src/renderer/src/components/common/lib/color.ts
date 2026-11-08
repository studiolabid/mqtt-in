const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Normalizes `#abc`, `abc`, `#AABBCC`, … to lower-case `#aabbcc`.
 * Returns `null` for anything that is not a 3- or 6-digit hex color.
 */
export function normalizeHex(input: string): string | null {
  const match = HEX_COLOR.exec(input.trim())
  if (!match) return null
  const hex = match[1].toLowerCase()
  return hex.length === 3 ? `#${Array.from(hex, (c) => c + c).join('')}` : `#${hex}`
}

/** Case- and shorthand-insensitive hex color equality. */
export function sameColor(a: string, b: string): boolean {
  const na = normalizeHex(a)
  return na !== null && na === normalizeHex(b)
}

/** Friendly names of the default `PALETTE` colors (for accessible labels). */
const NAMES: Readonly<Record<string, string>> = {
  '#71717a': 'Gray',
  '#8b5cf6': 'Violet',
  '#22c55e': 'Green',
  '#3b82f6': 'Blue',
  '#f59e0b': 'Amber',
  '#ec4899': 'Pink',
  '#06b6d4': 'Cyan',
  '#f97316': 'Orange',
  '#14b8a6': 'Teal',
  '#ef4444': 'Red',
  '#a855f7': 'Purple',
  '#84cc16': 'Lime',
  '#6366f1': 'Indigo'
}

/** Human name of a palette color, else the normalized hex (or the input as given). */
export function colorName(color: string): string {
  const hex = normalizeHex(color)
  return (hex && NAMES[hex]) ?? hex ?? color
}
