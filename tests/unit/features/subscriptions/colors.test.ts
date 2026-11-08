import { describe, expect, it } from 'vitest'
import { NEUTRAL_COLOR, PALETTE } from '@shared/defaults'
import {
  bulkColors,
  defaultSubscriptionColor,
  nextColors,
  paletteIndex
} from '@/features/subscriptions/utils/colors'

describe('subscription colors (UX-07)', () => {
  it('starts every new subscription neutral gray', () => {
    expect(defaultSubscriptionColor()).toBe(NEUTRAL_COLOR)
  })

  it('gives Add multiple the chosen color for every filter by default', () => {
    expect(bulkColors(3, NEUTRAL_COLOR, ['#22c55e', '#3b82f6'], false)).toEqual([
      NEUTRAL_COLOR,
      NEUTRAL_COLOR,
      NEUTRAL_COLOR
    ])
    expect(bulkColors(2, '#ec4899', [], false)).toEqual(['#ec4899', '#ec4899'])
    expect(bulkColors(0, NEUTRAL_COLOR, [], true)).toEqual([])
  })

  it('cycles the palette after the chosen color with "Give each a distinct color"', () => {
    expect(bulkColors(3, NEUTRAL_COLOR, [], true)).toEqual([NEUTRAL_COLOR, PALETTE[1], PALETTE[2]])
    // Colors the list already uses are skipped while unused ones remain.
    expect(bulkColors(3, NEUTRAL_COLOR, [PALETTE[1]], true)).toEqual([
      NEUTRAL_COLOR,
      PALETTE[2],
      PALETTE[3]
    ])
    // A custom chosen color: the palette starts after the list's colors.
    expect(bulkColors(2, '#123456', [], true)).toEqual(['#123456', PALETTE[1]])
  })

  it('repeats the palette once every color is taken', () => {
    expect(nextColors(PALETTE.length + 1, [], 0)).toEqual([...PALETTE, PALETTE[0]])
  })

  it('finds palette positions case-insensitively', () => {
    expect(paletteIndex('#22C55E')).toBe(1)
    expect(paletteIndex(' #71717a ')).toBe(0)
    expect(paletteIndex('#000000')).toBe(-1)
  })
})
