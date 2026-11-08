/**
 * The single registry of app keyboard shortcuts. Features register handlers with
 * `useHotkey(SHORTCUTS.x.combo, …)` and display hints with `<KbdShortcut :keys="SHORTCUTS.x.keys" />`;
 * the welcome screen, the shortcuts dialog and the settings page list them from here.
 *
 * Entries marked `displayOnly` document keys that something else handles (the native menu's zoom
 * accelerators, the Toaster's Alt+T, the keyboard handlers of focused lists): they are listed in
 * the cheat sheets but never passed to `useHotkey`.
 *
 * Rules (checked by tests/unit/renderer/shortcuts.test.ts): `keys` equal `shortcutKeys(combo)`,
 * combos are unique within a group, and every entry has a label.
 */
import { parseHotkey } from './hotkey'

export type ShortcutGroup = 'General' | 'Workspace' | 'Messages' | 'Publish' | 'View' | 'Lists'

export interface ShortcutDefinition {
  /** `useHotkey` combo (lower case, `+`-separated, `mod` = ⌘ on macOS / Ctrl elsewhere). */
  combo: string
  /** Keys for `KbdShortcut` (`Mod` is rendered per platform). */
  keys: readonly string[]
  label: string
  group: ShortcutGroup
  /** Documents a key handled elsewhere: listed, but never passed to `useHotkey`. */
  displayOnly?: true
}

export const SHORTCUTS = {
  commandPalette: {
    combo: 'mod+k',
    keys: ['Mod', 'K'],
    label: 'Command palette',
    group: 'General'
  },
  newConnection: {
    combo: 'mod+n',
    keys: ['Mod', 'N'],
    label: 'New connection',
    group: 'General'
  },
  settings: { combo: 'mod+,', keys: ['Mod', ','], label: 'Settings', group: 'General' },
  toggleSidebar: {
    combo: 'mod+b',
    keys: ['Mod', 'B'],
    label: 'Toggle sidebar',
    group: 'General'
  },
  toggleTheme: {
    combo: 'mod+shift+l',
    keys: ['Mod', 'Shift', 'L'],
    label: 'Toggle light / dark theme',
    group: 'General'
  },
  /** Handled by each dialog on its own element (not a window shortcut). */
  submitDialog: {
    combo: 'mod+enter',
    keys: ['Mod', 'Enter'],
    label: 'Save the open dialog',
    group: 'General'
  },
  /** vue-sonner's own hotkey: moves focus to the toasts (then Tab reaches Undo, Show…). */
  focusNotifications: {
    combo: 'alt+t',
    keys: ['Alt', 'T'],
    label: 'Focus notifications',
    group: 'General',
    displayOnly: true
  },
  newSubscription: {
    combo: 'mod+shift+n',
    keys: ['Mod', 'Shift', 'N'],
    label: 'New subscription',
    group: 'Workspace'
  },
  editConnection: {
    combo: 'mod+e',
    keys: ['Mod', 'E'],
    label: 'Edit connection',
    group: 'Workspace'
  },
  tabMessages: {
    combo: 'mod+1',
    keys: ['Mod', '1'],
    label: 'Show messages',
    group: 'Workspace'
  },
  tabTopics: { combo: 'mod+2', keys: ['Mod', '2'], label: 'Show topics', group: 'Workspace' },
  tabLogs: { combo: 'mod+3', keys: ['Mod', '3'], label: 'Show logs', group: 'Workspace' },
  search: {
    combo: 'mod+f',
    keys: ['Mod', 'F'],
    label: 'Search in the current panel',
    group: 'Workspace'
  },
  togglePause: {
    combo: 'mod+shift+p',
    keys: ['Mod', 'Shift', 'P'],
    label: 'Pause / resume messages',
    group: 'Messages'
  },
  clearMessages: {
    combo: 'mod+l',
    keys: ['Mod', 'L'],
    label: 'Clear messages',
    group: 'Messages'
  },
  /** Handled by the focused message list and the detail panel (not a window shortcut). */
  closeDetail: {
    combo: 'escape',
    keys: ['Esc'],
    label: 'Close message detail (in the list or detail)',
    group: 'Messages'
  },
  publish: { combo: 'mod+enter', keys: ['Mod', 'Enter'], label: 'Publish', group: 'Publish' },

  // View: accelerators of the native View menu (src/main/menu.ts).
  zoomIn: {
    combo: 'mod+=',
    keys: ['Mod', '='],
    label: 'Zoom in',
    group: 'View',
    displayOnly: true
  },
  zoomOut: {
    combo: 'mod+-',
    keys: ['Mod', '-'],
    label: 'Zoom out',
    group: 'View',
    displayOnly: true
  },
  actualSize: {
    combo: 'mod+0',
    keys: ['Mod', '0'],
    label: 'Actual size',
    group: 'View',
    displayOnly: true
  },

  // Lists: keys of a focused list (messages, subscriptions, topics, logs, connections).
  listPrevious: {
    combo: 'arrowup',
    keys: ['ArrowUp'],
    label: 'Previous item',
    group: 'Lists',
    displayOnly: true
  },
  listNext: {
    combo: 'arrowdown',
    keys: ['ArrowDown'],
    label: 'Next item',
    group: 'Lists',
    displayOnly: true
  },
  listFirst: {
    combo: 'home',
    keys: ['Home'],
    label: 'First item',
    group: 'Lists',
    displayOnly: true
  },
  listLast: { combo: 'end', keys: ['End'], label: 'Last item', group: 'Lists', displayOnly: true },
  listOpen: {
    combo: 'enter',
    keys: ['Enter'],
    label: 'Open or expand the item',
    group: 'Lists',
    displayOnly: true
  },
  listToggle: {
    combo: 'space',
    keys: ['Space'],
    label: 'Enable / disable a subscription',
    group: 'Lists',
    displayOnly: true
  },
  listCopy: {
    combo: 'c',
    keys: ['C'],
    label: 'Copy the payload, filter or entry',
    group: 'Lists',
    displayOnly: true
  },
  listCopyPayload: {
    combo: 'mod+c',
    keys: ['Mod', 'C'],
    label: 'Copy the payload (no text selected)',
    group: 'Lists',
    displayOnly: true
  },
  listDelete: {
    combo: 'delete',
    keys: ['Delete'],
    label: 'Delete the item',
    group: 'Lists',
    displayOnly: true
  },
  listEdit: {
    combo: 'f2',
    keys: ['F2'],
    label: 'Edit or rename the item',
    group: 'Lists',
    displayOnly: true
  },
  listMenu: {
    combo: 'shift+f10',
    keys: ['Shift', 'F10'],
    label: 'Open the item menu',
    group: 'Lists',
    displayOnly: true
  }
} as const satisfies Record<string, ShortcutDefinition>

export type ShortcutId = keyof typeof SHORTCUTS

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  'General',
  'Workspace',
  'Messages',
  'Publish',
  'View',
  'Lists'
]

/** Shortcuts grouped for display (cheat sheets, settings), display-only entries included. */
export function shortcutsByGroup(): Array<{ group: ShortcutGroup; items: ShortcutDefinition[] }> {
  const all = Object.values(SHORTCUTS) as ShortcutDefinition[]
  return SHORTCUT_GROUPS.map((group) => ({
    group,
    items: all.filter((s) => s.group === group)
  })).filter((g) => g.items.length > 0)
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  enter: 'Enter',
  escape: 'Esc',
  ' ': 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight'
}

/**
 * `KbdShortcut` keys of a combo, in the registry's order (Mod, Ctrl, Meta, Alt, Shift, key):
 * `mod+shift+p` → `['Mod', 'Shift', 'P']`, `shift+f10` → `['Shift', 'F10']`.
 *
 * @throws Error for a combo `parseHotkey` rejects.
 */
export function shortcutKeys(combo: string): string[] {
  const hotkey = parseHotkey(combo)
  const keys: string[] = []
  if (hotkey.mod) keys.push('Mod')
  if (hotkey.ctrl) keys.push('Ctrl')
  if (hotkey.meta) keys.push('Meta')
  if (hotkey.alt) keys.push('Alt')
  if (hotkey.shift) keys.push('Shift')
  keys.push(KEY_NAMES[hotkey.key] ?? hotkey.key.toUpperCase())
  return keys
}
