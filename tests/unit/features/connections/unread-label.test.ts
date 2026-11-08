import { describe, expect, it } from 'vitest'
import { formatNumber } from '@/utils/format'
import {
  UNREAD_CAP,
  unreadLabel,
  unreadSpoken,
  unreadTitle
} from '@/features/connections/utils/unread-label'

describe('unread pill (FP-2)', () => {
  it.each([
    [0, ''],
    [-3, ''],
    [Number.NaN, ''],
    [1, '1'],
    [5, '5'],
    [99, '99'],
    [100, '99+'],
    [120, '99+'],
    [1_000_000, '99+']
  ])('%d → %j', (count, label) => {
    expect(unreadLabel(count)).toBe(label)
  })

  it('caps at 99', () => {
    expect(UNREAD_CAP).toBe(99)
  })

  it('explains the count in the tooltip and the accessible name', () => {
    expect(unreadTitle(5)).toBe('5 new messages since you last viewed this connection')
    expect(unreadTitle(1)).toBe('1 new message since you last viewed this connection')
    expect(unreadSpoken(5)).toBe('5 new messages')
    expect(unreadSpoken(1_234)).toBe(`${formatNumber(1_234)} new messages`)
  })
})
