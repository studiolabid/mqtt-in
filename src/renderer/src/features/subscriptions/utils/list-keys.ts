/**
 * Keyboard handling of a focused list element (pure): arrows / Home / End / PageUp / PageDown
 * move the cursor, Enter activates, Space toggles, E / F2 edit, C copies, Delete removes,
 * Escape clears and Shift+F10 / the menu key open the row menu. Keys are only handled when the
 * list element itself has focus (not a control inside a row) and without Ctrl / Alt / Meta, so
 * window-level shortcuts keep working.
 */
/** A cursor move: a number of rows (negative = up) or the first / last row. */
export type CursorMove = number | 'first' | 'last'

export interface ListKeyHandlers {
  move(to: CursorMove): void
  activate(): void
  toggle(): void
  edit(): void
  copy(): void
  remove(): void
  /** Returns whether Escape was used (otherwise it propagates). */
  escape(): boolean
  contextMenu(): void
}

/** Display labels of the row keys (context menu hints). */
export const LIST_KEYS = {
  activate: 'Enter',
  toggle: 'Space',
  edit: 'E',
  copy: 'C',
  remove: 'Delete'
} as const

const PAGE = 10

export function createListKeydown(handlers: ListKeyHandlers): (event: KeyboardEvent) => void {
  return (event) => {
    if (event.target !== event.currentTarget || event.isComposing) return
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault()
      handlers.contextMenu()
      return
    }
    if (run(handlers, event.key)) event.preventDefault()
  }
}

function run(handlers: ListKeyHandlers, key: string): boolean {
  switch (key) {
    case 'ArrowDown':
      handlers.move(1)
      return true
    case 'ArrowUp':
      handlers.move(-1)
      return true
    case 'PageDown':
      handlers.move(PAGE)
      return true
    case 'PageUp':
      handlers.move(-PAGE)
      return true
    case 'Home':
      handlers.move('first')
      return true
    case 'End':
      handlers.move('last')
      return true
    case 'Enter':
      handlers.activate()
      return true
    case ' ':
      handlers.toggle()
      return true
    case 'F2':
    case 'e':
    case 'E':
      handlers.edit()
      return true
    case 'c':
    case 'C':
      handlers.copy()
      return true
    case 'Delete':
    case 'Backspace':
      handlers.remove()
      return true
    case 'Escape':
      return handlers.escape()
    default:
      return false
  }
}
