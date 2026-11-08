import { describe, expect, it } from 'vitest'
import { logRowAria, logRowId } from '@/features/logs/utils/row-aria'

describe('log row ARIA (A11Y-09)', () => {
  it('gives every row a stable id for aria-activedescendant', () => {
    expect(logRowId(42)).toBe('log-row-42')
    expect(logRowAria({ id: 42 }, { active: false, expanded: false, index: 0, total: 1 }).id).toBe(
      'log-row-42'
    )
  })

  it('is an option selected while under the cursor, positioned in the whole list', () => {
    expect(logRowAria({ id: 7 }, { active: true, expanded: false, index: 4, total: 120 })).toEqual({
      id: 'log-row-7',
      role: 'option',
      'aria-selected': true,
      'aria-posinset': 5,
      'aria-setsize': 120
    })
    expect(
      logRowAria({ id: 7 }, { active: false, expanded: false, index: 0, total: 1 })['aria-selected']
    ).toBe(false)
  })

  it('reports aria-expanded only for entries that have a detail', () => {
    const plain = logRowAria({ id: 1 }, { active: false, expanded: false, index: 0, total: 2 })
    expect(plain).not.toHaveProperty('aria-expanded')
    const collapsed = logRowAria(
      { id: 2, detail: '{"reasonCode":135}' },
      { active: false, expanded: false, index: 1, total: 2 }
    )
    expect(collapsed['aria-expanded']).toBe(false)
    const open = logRowAria(
      { id: 2, detail: '{"reasonCode":135}' },
      { active: true, expanded: true, index: 1, total: 2 }
    )
    expect(open['aria-expanded']).toBe(true)
  })
})
