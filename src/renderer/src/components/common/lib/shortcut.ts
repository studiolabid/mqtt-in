/**
 * Keyboard shortcut labels. Keys are written platform-neutrally (`['Mod', 'Shift', 'K']`,
 * `Mod` = ⌘ on macOS, Ctrl elsewhere) and rendered per platform.
 */

const MAC_KEYS: Readonly<Record<string, string>> = {
  mod: '⌘',
  cmd: '⌘',
  command: '⌘',
  meta: '⌘',
  shift: '⇧',
  alt: '⌥',
  option: '⌥',
  ctrl: '⌃',
  control: '⌃',
  enter: '↵',
  return: '↵',
  backspace: '⌫',
  delete: '⌦',
  escape: 'Esc',
  esc: 'Esc',
  tab: '⇥',
  space: 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pageup: 'PgUp',
  pagedown: 'PgDn'
}

const OTHER_KEYS: Readonly<Record<string, string>> = {
  mod: 'Ctrl',
  cmd: 'Ctrl',
  command: 'Ctrl',
  meta: 'Win',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Backspace',
  delete: 'Del',
  escape: 'Esc',
  esc: 'Esc',
  tab: 'Tab',
  space: 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pageup: 'PgUp',
  pagedown: 'PgDn'
}

/**
 * True for macOS. `platform` accepts `process.platform` values (`darwin`) or names starting
 * with `mac`; when omitted the browser user agent is inspected.
 */
export function isMacPlatform(platform?: string): boolean {
  if (platform) {
    const p = platform.toLowerCase()
    return p === 'darwin' || p.startsWith('mac')
  }
  return typeof navigator !== 'undefined' && /Macintosh|Mac OS X/i.test(navigator.userAgent)
}

/** Label of a single key: `Mod` → `⌘` / `Ctrl`, single characters upper-cased. */
export function formatShortcutKey(key: string, mac: boolean): string {
  const mapped = (mac ? MAC_KEYS : OTHER_KEYS)[key.toLowerCase()]
  if (mapped) return mapped
  return Array.from(key).length === 1 ? key.toUpperCase() : key
}

/** Whole shortcut as text: `⌘⇧K` on macOS, `Ctrl+Shift+K` elsewhere. */
export function formatShortcut(keys: readonly string[], platform?: string): string {
  const mac = isMacPlatform(platform)
  return keys.map((key) => formatShortcutKey(key, mac)).join(mac ? '' : '+')
}
