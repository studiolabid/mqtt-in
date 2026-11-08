/**
 * Keyboard navigation of the focused message list (a local `@keydown`, not a window hotkey):
 * ↑ / ↓, PgUp / PgDn, Home / End move the selection, Esc clears it, C copies the payload,
 * T the topic. Ctrl/⌘+C copies the payload too unless text is selected.
 */
import type { Ref } from 'vue'
import type { MqttMessage } from '@shared/models'
import { isEditableTarget } from '@/utils/hotkey'
import { indexOfId } from '../utils/message-index'

export interface ListKeyboardOptions {
  scroller: Readonly<Ref<HTMLElement | null>>
  rows: Readonly<Ref<readonly MqttMessage[]>>
  rowHeight: number
  selectedId: Readonly<Ref<number | null>>
  select(id: number | null): void
  /** Brings the row at `index` into view. */
  reveal(index: number): void
  /** Called before moving away from the newest row (stops following). */
  release(): void
  copyPayload(message: MqttMessage): void
  copyTopic(message: MqttMessage): void
}

function hasTextSelection(): boolean {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed && selection.toString().length > 0
}

export function useListKeyboard(options: ListKeyboardOptions): (event: KeyboardEvent) => void {
  const { scroller, rows, rowHeight } = options

  /** First / last fully visible row and a page step. */
  function viewport(): { first: number; last: number; page: number } {
    const el = scroller.value
    const lastIndex = rows.value.length - 1
    if (!el) return { first: 0, last: lastIndex, page: 10 }
    const bottom = Math.floor((el.scrollTop + el.clientHeight) / rowHeight) - 1
    return {
      first: Math.min(lastIndex, Math.ceil(el.scrollTop / rowHeight)),
      last: Math.max(0, Math.min(lastIndex, bottom)),
      page: Math.max(1, Math.floor(el.clientHeight / rowHeight) - 1)
    }
  }

  /** Index to move to for a navigation key, or null when the key is not one. */
  function target(key: string, current: number, lastIndex: number): number | null {
    const view = viewport()
    switch (key) {
      case 'ArrowDown':
        return current < 0 ? view.first : Math.min(current + 1, lastIndex)
      case 'ArrowUp':
        return current < 0 ? view.last : Math.max(current - 1, 0)
      case 'PageDown':
        return current < 0 ? view.last : Math.min(current + view.page, lastIndex)
      case 'PageUp':
        return current < 0 ? view.first : Math.max(current - view.page, 0)
      case 'Home':
        return 0
      case 'End':
        return lastIndex
      default:
        return null
    }
  }

  return (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.altKey) return
    if (event.target !== scroller.value && isEditableTarget(event.target)) return
    const list = rows.value
    if (list.length === 0) return
    const mod = event.ctrlKey || event.metaKey
    const selected = options.selectedId.value
    const current = selected === null ? -1 : indexOfId(list, selected)
    const key = event.key

    if (key === 'Escape') {
      if (selected === null) return
      event.preventDefault()
      event.stopPropagation()
      options.select(null)
      return
    }
    if (key === 'c' || key === 'C' || key === 't' || key === 'T') {
      const copyTopic = key === 't' || key === 'T'
      if (event.shiftKey || current < 0 || (copyTopic && mod) || (mod && hasTextSelection())) {
        return
      }
      event.preventDefault()
      if (copyTopic) options.copyTopic(list[current])
      else options.copyPayload(list[current])
      return
    }

    const lastIndex = list.length - 1
    const next = target(key, current, lastIndex)
    if (next === null || (mod && key !== 'Home' && key !== 'End')) return
    event.preventDefault()
    if (next !== lastIndex) options.release()
    options.select(list[next].id)
    options.reveal(next)
  }
}
