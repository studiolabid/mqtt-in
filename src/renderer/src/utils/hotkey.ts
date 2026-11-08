/**
 * Keyboard shortcut parsing, matching and display (pure, no Vue).
 *
 * Combos are `+`-separated, case-insensitive: `mod+k`, `mod+shift+f`, `escape`, `mod+,`.
 * `mod` is ⌘ (Meta) on macOS and Control elsewhere.
 */

export interface Hotkey {
  /** Normalized `KeyboardEvent.key` (lower case): `k`, `enter`, `escape`, `,`, `arrowup`… */
  key: string
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/** The subset of `KeyboardEvent` used for matching (keeps the logic testable). */
export interface HotkeyEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
  ins: 'insert',
  plus: '+',
  comma: ',',
  period: '.',
  slash: '/',
  minus: '-'
}

const MODIFIERS = new Set([
  'mod',
  'ctrl',
  'control',
  'meta',
  'cmd',
  'command',
  'alt',
  'option',
  'shift'
])

const ALPHANUMERIC = /^[a-z0-9]$/

/**
 * Parses a combo such as `mod+shift+f`.
 *
 * @throws Error when the combo has no key or an unknown modifier.
 */
export function parseHotkey(combo: string): Hotkey {
  const raw = combo.trim().toLowerCase()
  // A trailing `++` means the `+` key itself (`mod++`).
  const plusKey = raw.endsWith('++') || raw === '+'
  const parts = (plusKey ? raw.replace(/\+*$/, '') : raw).split('+').filter((p) => p.length > 0)
  const keyToken = plusKey ? '+' : parts.pop()
  if (!keyToken || (!plusKey && MODIFIERS.has(keyToken))) {
    throw new Error(`Invalid hotkey "${combo}": missing key`)
  }

  const hotkey: Hotkey = {
    key: KEY_ALIASES[keyToken] ?? keyToken,
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false
  }
  for (const part of parts) {
    switch (part) {
      case 'mod':
        hotkey.mod = true
        break
      case 'ctrl':
      case 'control':
        hotkey.ctrl = true
        break
      case 'meta':
      case 'cmd':
      case 'command':
        hotkey.meta = true
        break
      case 'alt':
      case 'option':
        hotkey.alt = true
        break
      case 'shift':
        hotkey.shift = true
        break
      default:
        throw new Error(`Invalid hotkey "${combo}": unknown modifier "${part}"`)
    }
  }
  return hotkey
}

/** True when the keyboard event triggers the hotkey on the given platform. */
export function matchesHotkey(event: HotkeyEventLike, hotkey: Hotkey, platform: string): boolean {
  const mac = platform === 'darwin'
  const wantCtrl = hotkey.ctrl || (hotkey.mod && !mac)
  const wantMeta = hotkey.meta || (hotkey.mod && mac)
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta || event.altKey !== hotkey.alt) {
    return false
  }

  const key = normalizeEventKey(event.key)
  if (ALPHANUMERIC.test(hotkey.key)) {
    if (event.shiftKey !== hotkey.shift) return false
    if (key === hotkey.key) return true
    // Another Latin letter is another key (e.g. on AZERTY). Anything else (Option + F = `ƒ`,
    // Cyrillic layouts…) falls back to the physical key.
    return !ALPHANUMERIC.test(key) && codeMatches(event.code, hotkey.key)
  }
  if (hotkey.shift !== event.shiftKey) {
    // Symbols such as `?` or `<` may need Shift on the user's layout: only enforce it for
    // named keys (Enter, Escape, arrows…) or when the combo asks for Shift explicitly.
    if (hotkey.shift || hotkey.key.length > 1 || hotkey.key === ' ') return false
  }
  return key === hotkey.key
}

/** Display tokens, e.g. `['Ctrl', 'Shift', 'F']` or `['⌘', '⇧', 'F']` on macOS. */
export function formatHotkey(combo: string, platform: string): string[] {
  const hotkey = parseHotkey(combo)
  const mac = platform === 'darwin'
  const tokens: string[] = []
  if (mac) {
    if (hotkey.ctrl) tokens.push('⌃')
    if (hotkey.alt) tokens.push('⌥')
    if (hotkey.shift) tokens.push('⇧')
    if (hotkey.meta || hotkey.mod) tokens.push('⌘')
  } else {
    if (hotkey.ctrl || hotkey.mod) tokens.push('Ctrl')
    if (hotkey.meta) tokens.push('Win')
    if (hotkey.alt) tokens.push('Alt')
    if (hotkey.shift) tokens.push('Shift')
  }
  tokens.push(keyLabel(hotkey.key, mac))
  return tokens
}

/** Single string for tooltips: `Ctrl+Shift+F` / `⌘⇧F`. */
export function hotkeyLabel(combo: string, platform: string): string {
  return formatHotkey(combo, platform).join(platform === 'darwin' ? '' : '+')
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit'
])

interface ElementLike {
  tagName?: string
  type?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

/** True for text inputs, textareas, selects, contenteditable elements and CodeMirror editors. */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as ElementLike
  if (typeof el.closest === 'function' && el.closest('.cm-editor')) return true
  const tag = el.tagName?.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el.type ?? 'text').toLowerCase())
  return el.isContentEditable === true
}

function normalizeEventKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return ' '
  if (key === 'Esc') return 'escape'
  return key.toLowerCase()
}

function codeMatches(code: string | undefined, key: string): boolean {
  if (!code) return false
  if (key >= 'a' && key <= 'z') return code === `Key${key.toUpperCase()}`
  return code === `Digit${key}` || code === `Numpad${key}`
}

const MAC_KEY_LABELS: Record<string, string> = {
  enter: '↩',
  escape: 'Esc',
  backspace: '⌫',
  delete: '⌦',
  tab: '⇥',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space'
}

const KEY_LABELS: Record<string, string> = {
  enter: 'Enter',
  escape: 'Esc',
  backspace: 'Backspace',
  delete: 'Del',
  tab: 'Tab',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space'
}

function keyLabel(key: string, mac: boolean): string {
  const label = (mac ? MAC_KEY_LABELS : KEY_LABELS)[key]
  if (label) return label
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase()
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1)
}
