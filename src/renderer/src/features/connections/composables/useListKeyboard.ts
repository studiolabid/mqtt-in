/**
 * Keyboard navigation of the sidebar list: one tab stop (roving tabindex) and arrow / Home /
 * End movement over every `[data-nav]` element (group headers and items) in DOM order.
 */
import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'

export interface ListKeyboardOptions {
  root: Ref<HTMLElement | null>
  /** Ids of the items currently rendered, in order. */
  visibleIds: () => string[]
  /** The item that should own the tab stop by default (the open connection). */
  preferredId: () => string | null
}

export interface ListKeyboard {
  /** Item that is reachable with Tab (null when no item is rendered). */
  tabStopId: ComputedRef<string | null>
  /** Remember the focused item so it keeps the tab stop. */
  onFocusItem(id: string): void
  /** Arrow / Home / End navigation; returns true when the event was handled. */
  navigate(event: KeyboardEvent): boolean
  focusItem(id: string): void
  focusFirst(): void
}

export function useListKeyboard(options: ListKeyboardOptions): ListKeyboard {
  const focusedId = ref<string | null>(null)

  const tabStopId = computed(() => {
    const ids = options.visibleIds()
    if (focusedId.value && ids.includes(focusedId.value)) return focusedId.value
    const preferred = options.preferredId()
    if (preferred && ids.includes(preferred)) return preferred
    return ids[0] ?? null
  })

  function targets(): HTMLElement[] {
    return Array.from(
      options.root.value?.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])') ?? []
    )
  }

  function navigate(event: KeyboardEvent): boolean {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
    const all = targets()
    if (all.length === 0) return false
    const source = event.target instanceof Element ? event.target : null
    // Focus may sit on an item's secondary button: navigate relative to the item.
    const owner =
      source?.closest('[data-connection-id]')?.querySelector<HTMLElement>('[data-nav]') ??
      source?.closest<HTMLElement>('[data-nav]') ??
      null
    const current = owner ? all.indexOf(owner) : -1
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = current === -1 ? 0 : Math.min(all.length - 1, current + 1)
        break
      case 'ArrowUp':
        next = current === -1 ? 0 : Math.max(0, current - 1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = all.length - 1
        break
      default:
        return false
    }
    all[next]?.focus()
    return true
  }

  function focusItem(id: string): void {
    focusedId.value = id
    void nextTick(() => {
      const item = options.root.value?.querySelector(`[data-connection-id="${CSS.escape(id)}"]`)
      item?.querySelector<HTMLElement>('[data-nav]')?.focus()
    })
  }

  function focusFirst(): void {
    targets()[0]?.focus()
  }

  return {
    tabStopId,
    onFocusItem: (id) => {
      focusedId.value = id
    },
    navigate,
    focusItem,
    focusFirst
  }
}
