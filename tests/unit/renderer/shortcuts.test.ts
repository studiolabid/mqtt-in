import { describe, expect, it } from 'vitest'
import { parseHotkey } from '@/utils/hotkey'
import {
  SHORTCUT_GROUPS,
  SHORTCUTS,
  shortcutKeys,
  shortcutsByGroup,
  type ShortcutDefinition
} from '@/utils/shortcuts'

const entries = Object.entries(SHORTCUTS) as Array<[string, ShortcutDefinition]>

describe('SHORTCUTS registry consistency (HEALTH-05)', () => {
  it('keeps keys equal to the parse of the combo', () => {
    for (const [id, shortcut] of entries) {
      expect(() => parseHotkey(shortcut.combo), id).not.toThrow()
      expect(shortcut.keys, id).toEqual(shortcutKeys(shortcut.combo))
    }
  })

  it('has unique combos within each group', () => {
    for (const group of SHORTCUT_GROUPS) {
      const combos = entries.filter(([, s]) => s.group === group).map(([, s]) => s.combo)
      expect(new Set(combos).size, group).toBe(combos.length)
    }
  })

  it('never binds the same window combo twice', () => {
    // `submitDialog` and `publish` share mod+enter on purpose: one is handled by the open
    // dialog's element, the other by the workspace (dialogs block it).
    const shared = new Set(['mod+enter'])
    const bound = entries
      .filter(([, s]) => !s.displayOnly && !shared.has(s.combo))
      .map(([, s]) => s.combo)
    expect(new Set(bound).size).toBe(bound.length)
  })

  it('labels every entry, display-only ones included', () => {
    for (const [id, shortcut] of entries) {
      expect(shortcut.label.trim().length, id).toBeGreaterThan(0)
      expect(SHORTCUT_GROUPS, id).toContain(shortcut.group)
    }
    expect(entries.filter(([, s]) => s.displayOnly).length).toBeGreaterThan(10)
  })

  it('lists every group in order, display-only entries included', () => {
    const groups = shortcutsByGroup()
    expect(groups.map((g) => g.group)).toEqual(SHORTCUT_GROUPS)
    const total = groups.reduce((n, g) => n + g.items.length, 0)
    expect(total).toBe(entries.length)
  })
})

describe('SHORTCUTS additions (CT-17)', () => {
  it('adds pause and edit connection without colliding with CodeMirror or other combos', () => {
    expect(SHORTCUTS.togglePause).toEqual({
      combo: 'mod+shift+p',
      keys: ['Mod', 'Shift', 'P'],
      label: 'Pause / resume messages',
      group: 'Messages'
    })
    expect(SHORTCUTS.editConnection).toEqual({
      combo: 'mod+e',
      keys: ['Mod', 'E'],
      label: 'Edit connection',
      group: 'Workspace'
    })
    // CodeMirror's default keymaps use Mod-Shift-l, Mod-Shift-k, Mod-Shift-\, Mod-Alt-… but
    // neither Mod-e nor Mod-Shift-p.
    const others = entries
      .filter(([id]) => id !== 'togglePause' && id !== 'editConnection')
      .map(([, s]) => s.combo)
    expect(others).not.toContain('mod+shift+p')
    expect(others).not.toContain('mod+e')
  })

  it('documents zoom, Alt+T and the list keys as display-only entries', () => {
    expect(SHORTCUTS.zoomIn).toMatchObject({ keys: ['Mod', '='], group: 'View', displayOnly: true })
    expect(SHORTCUTS.zoomOut).toMatchObject({ keys: ['Mod', '-'], group: 'View' })
    expect(SHORTCUTS.actualSize).toMatchObject({ keys: ['Mod', '0'], group: 'View' })
    expect(SHORTCUTS.focusNotifications).toMatchObject({
      keys: ['Alt', 'T'],
      label: 'Focus notifications',
      group: 'General',
      displayOnly: true
    })
    const lists = shortcutsByGroup().find((g) => g.group === 'Lists')?.items ?? []
    expect(lists.map((s) => s.keys.join('+'))).toEqual([
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'Enter',
      'Space',
      'C',
      'Mod+C',
      'Delete',
      'F2',
      'Shift+F10'
    ])
    expect(lists.every((s) => s.displayOnly)).toBe(true)
    expect(SHORTCUTS.closeDetail.label).toBe('Close message detail (in the list or detail)')
  })

  it('derives display keys from combos', () => {
    expect(shortcutKeys('mod+shift+p')).toEqual(['Mod', 'Shift', 'P'])
    expect(shortcutKeys('shift+f10')).toEqual(['Shift', 'F10'])
    expect(shortcutKeys('escape')).toEqual(['Esc'])
    expect(shortcutKeys('space')).toEqual(['Space'])
    expect(shortcutKeys('mod+,')).toEqual(['Mod', ','])
    expect(shortcutKeys('ctrl+alt+arrowleft')).toEqual(['Ctrl', 'Alt', 'ArrowLeft'])
    expect(() => shortcutKeys('mod+')).toThrow()
  })
})
