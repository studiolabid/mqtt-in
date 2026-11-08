/**
 * Keyboard handling of the focused log list (bound with `@keydown` on the list element, never
 * on window): ↑/↓ (j/k), PgUp/PgDn, Home/End move the cursor, Enter / Space toggle the detail,
 * → / ← open / close it, C (or Ctrl+C without a text selection) copies the entry, Esc clears
 * the cursor.
 */
import type { Ref } from 'vue'
import type { LogEntry } from '@shared/models'

export interface LogListKeysOptions {
  rows: () => readonly LogEntry[]
  /** Id of the entry under the cursor. */
  activeId: Ref<number | null>
  /** Rendered range (visible rows) of the virtualizer. */
  range: () => { startIndex: number; endIndex: number } | null
  /** Scrolls a row into view. */
  reveal(index: number): void
  toggle(entry: LogEntry, open?: boolean): void
  copy(entry: LogEntry): void
  hasSelection(): boolean
}

export function useLogListKeys(options: LogListKeysOptions): (event: KeyboardEvent) => void {
  function moveTo(index: number): void {
    const rows = options.rows()
    const clamped = Math.max(0, Math.min(rows.length - 1, index))
    const entry = rows[clamped]
    if (!entry) return
    options.activeId.value = entry.id
    options.reveal(clamped)
  }

  return function onKeydown(event: KeyboardEvent): void {
    // Keys typed on a nested control (e.g. a copy button) keep their own behavior.
    if (event.target !== event.currentTarget || event.altKey || event.isComposing) return
    const rows = options.rows()
    if (rows.length === 0) return
    const id = options.activeId.value
    const current = id === null ? -1 : rows.findIndex((entry) => entry.id === id)
    const entry = current === -1 ? undefined : rows[current]
    const range = options.range()
    const page = range ? Math.max(1, range.endIndex - range.startIndex) : 10
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

    if (mod) {
      if (key !== 'c' || !entry || options.hasSelection()) return
      options.copy(entry)
    } else {
      switch (key) {
        case 'ArrowDown':
        case 'j':
          moveTo(current === -1 ? (range?.startIndex ?? 0) : current + 1)
          break
        case 'ArrowUp':
        case 'k':
          moveTo(current === -1 ? (range?.endIndex ?? rows.length - 1) : current - 1)
          break
        case 'PageDown':
          moveTo((current === -1 ? (range?.startIndex ?? 0) : current) + page)
          break
        case 'PageUp':
          moveTo((current === -1 ? (range?.endIndex ?? rows.length - 1) : current) - page)
          break
        case 'Home':
          moveTo(0)
          break
        case 'End':
          moveTo(rows.length - 1)
          break
        case 'Enter':
        case ' ':
          if (!entry) return
          options.toggle(entry)
          break
        case 'ArrowRight':
          if (!entry) return
          options.toggle(entry, true)
          break
        case 'ArrowLeft':
          if (!entry) return
          options.toggle(entry, false)
          break
        case 'c':
          if (!entry) return
          options.copy(entry)
          break
        case 'Escape':
          if (id === null) return
          options.activeId.value = null
          break
        default:
          return
      }
    }
    // Window-level hotkeys skip prevented events, so nothing else handles the key.
    event.preventDefault()
  }
}
