import { describe, expect, it } from 'vitest'
import {
  formatHotkey,
  hotkeyLabel,
  isEditableTarget,
  matchesHotkey,
  parseHotkey,
  type HotkeyEventLike
} from '@/utils/hotkey'

function key(key: string, mods: Partial<HotkeyEventLike> = {}): HotkeyEventLike {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods }
}

function matches(combo: string, event: HotkeyEventLike, platform = 'win32'): boolean {
  return matchesHotkey(event, parseHotkey(combo), platform)
}

describe('parseHotkey', () => {
  it('parses modifiers and the key (case-insensitive)', () => {
    expect(parseHotkey('Mod+Shift+F')).toEqual({
      key: 'f',
      mod: true,
      ctrl: false,
      meta: false,
      alt: false,
      shift: true
    })
    expect(parseHotkey('ctrl+alt+delete')).toMatchObject({ key: 'delete', ctrl: true, alt: true })
    expect(parseHotkey('cmd+option+k')).toMatchObject({ key: 'k', meta: true, alt: true })
  })

  it('understands key aliases and punctuation', () => {
    expect(parseHotkey('esc').key).toBe('escape')
    expect(parseHotkey('mod+return').key).toBe('enter')
    expect(parseHotkey('space').key).toBe(' ')
    expect(parseHotkey('mod+,').key).toBe(',')
    expect(parseHotkey('mod++')).toMatchObject({ key: '+', mod: true })
    expect(parseHotkey('+').key).toBe('+')
    expect(parseHotkey('up').key).toBe('arrowup')
  })

  it.each(['', '  ', 'mod+', 'shift', 'ctrl+shift', 'hyper+k'])('rejects %j', (combo) => {
    expect(() => parseHotkey(combo)).toThrow(/Invalid hotkey/)
  })
})

describe('matchesHotkey', () => {
  it('maps mod to Control on Windows / Linux and to Meta on macOS', () => {
    expect(matches('mod+k', key('k', { ctrlKey: true }), 'win32')).toBe(true)
    expect(matches('mod+k', key('k', { ctrlKey: true }), 'linux')).toBe(true)
    expect(matches('mod+k', key('k', { metaKey: true }), 'darwin')).toBe(true)
    expect(matches('mod+k', key('k', { ctrlKey: true }), 'darwin')).toBe(false)
    expect(matches('mod+k', key('k', { metaKey: true }), 'win32')).toBe(false)
  })

  it('requires the exact modifiers', () => {
    expect(matches('mod+k', key('k'))).toBe(false)
    expect(matches('mod+k', key('k', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(matches('mod+k', key('K', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matches('mod+shift+f', key('F', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(matches('mod+shift+f', key('f', { ctrlKey: true }))).toBe(false)
  })

  it('matches named keys with exact Shift', () => {
    expect(matches('escape', key('Escape'))).toBe(true)
    expect(matches('escape', key('Esc'))).toBe(true)
    expect(matches('mod+enter', key('Enter', { ctrlKey: true }))).toBe(true)
    expect(matches('mod+enter', key('Enter', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matches('space', key(' '))).toBe(true)
    expect(matches('space', key(' ', { shiftKey: true }))).toBe(false)
  })

  it('tolerates the Shift needed to type a symbol', () => {
    expect(matches('?', key('?', { shiftKey: true }))).toBe(true)
    expect(matches('mod+,', key(',', { ctrlKey: true }))).toBe(true)
    expect(matches('mod+shift+,', key(',', { ctrlKey: true }))).toBe(false)
  })

  it('falls back to the physical key when the layout produces another character', () => {
    // Option + F on macOS types "ƒ"; Cyrillic layouts type "л" on the K key.
    const optionF = key('ƒ', { altKey: true, metaKey: true, code: 'KeyF' })
    expect(matches('mod+alt+f', optionF, 'darwin')).toBe(true)
    expect(matches('mod+k', key('л', { ctrlKey: true, code: 'KeyK' }))).toBe(true)
    expect(matches('mod+1', key('&', { ctrlKey: true, code: 'Digit1' }))).toBe(true)
    // But another Latin letter is another key (AZERTY "q" is on the QWERTY "A" key).
    expect(matches('mod+a', key('q', { ctrlKey: true, code: 'KeyA' }))).toBe(false)
  })
})

describe('formatHotkey / hotkeyLabel', () => {
  it('uses symbols on macOS', () => {
    expect(formatHotkey('mod+shift+k', 'darwin')).toEqual(['⇧', '⌘', 'K'])
    expect(formatHotkey('ctrl+alt+enter', 'darwin')).toEqual(['⌃', '⌥', '↩'])
    expect(hotkeyLabel('mod+k', 'darwin')).toBe('⌘K')
  })

  it('uses words elsewhere', () => {
    expect(formatHotkey('mod+shift+k', 'win32')).toEqual(['Ctrl', 'Shift', 'K'])
    expect(formatHotkey('escape', 'linux')).toEqual(['Esc'])
    expect(formatHotkey('mod+,', 'win32')).toEqual(['Ctrl', ','])
    expect(formatHotkey('f5', 'win32')).toEqual(['F5'])
    expect(hotkeyLabel('mod+enter', 'win32')).toBe('Ctrl+Enter')
  })
})

describe('isEditableTarget', () => {
  function element(props: Record<string, unknown>, editor = false): Record<string, unknown> {
    return {
      closest: (selector: string) => (editor && selector === '.cm-editor' ? {} : null),
      ...props
    }
  }

  it('detects text inputs, textareas, selects and contenteditable', () => {
    expect(isEditableTarget(element({ tagName: 'INPUT', type: 'text' }))).toBe(true)
    expect(isEditableTarget(element({ tagName: 'input' }))).toBe(true)
    expect(isEditableTarget(element({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(isEditableTarget(element({ tagName: 'SELECT' }))).toBe(true)
    expect(isEditableTarget(element({ tagName: 'DIV', isContentEditable: true }))).toBe(true)
  })

  it('detects CodeMirror editors', () => {
    expect(isEditableTarget(element({ tagName: 'DIV' }, true))).toBe(true)
  })

  it('ignores buttons, checkboxes and non-elements', () => {
    expect(isEditableTarget(element({ tagName: 'INPUT', type: 'checkbox' }))).toBe(false)
    expect(isEditableTarget(element({ tagName: 'BUTTON' }))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget('input')).toBe(false)
    expect(isEditableTarget({})).toBe(false)
  })
})
