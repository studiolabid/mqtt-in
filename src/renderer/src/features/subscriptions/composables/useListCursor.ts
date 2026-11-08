/**
 * Keyboard cursor over a list of ids (for `aria-activedescendant` lists). The cursor survives
 * list changes while its id still exists; it never points at an id that left the list.
 */
import { computed, ref, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { CursorMove } from '../utils/list-keys'

export interface ListCursor {
  /** Active id, or null. */
  active: ComputedRef<string | null>
  set(id: string | null): void
  /** Moves by a number of rows (clamped) or to the first / last row; returns the new id. */
  move(to: CursorMove): string | null
}

export function useListCursor(ids: MaybeRefOrGetter<readonly string[]>): ListCursor {
  const current = ref<string | null>(null)

  const active = computed(() => {
    const id = current.value
    return id !== null && toValue(ids).includes(id) ? id : null
  })

  function move(to: CursorMove): string | null {
    const list = toValue(ids)
    if (list.length === 0) {
      current.value = null
      return null
    }
    const index = active.value === null ? -1 : list.indexOf(active.value)
    let next: number
    if (to === 'first') next = 0
    else if (to === 'last') next = list.length - 1
    else if (index === -1) next = to > 0 ? 0 : list.length - 1
    else next = Math.min(list.length - 1, Math.max(0, index + to))
    current.value = list[next]
    return current.value
  }

  return {
    active,
    set: (id) => {
      current.value = id
    },
    move
  }
}
