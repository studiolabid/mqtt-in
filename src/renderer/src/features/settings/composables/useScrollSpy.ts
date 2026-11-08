/**
 * Scroll-spy for an in-page navigation: tracks which section of a scroll container is current
 * and jumps to sections. A section picked from the navigation stays current until the user
 * scrolls again (the last sections may be too short to ever reach the top).
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'

export interface ScrollSpyOptions<T extends string> {
  ids: readonly T[]
  /** DOM id of a section element. */
  domId(id: T): string
  /** Distance from the container top at which a section becomes current. Default 32. */
  offset?: number
}

export interface ScrollSpy<T extends string> {
  active: Ref<T>
  scrollTo(id: T): void
}

const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

export function useScrollSpy<T extends string>(
  container: Ref<HTMLElement | null>,
  options: ScrollSpyOptions<T>
): ScrollSpy<T> {
  const { ids, domId } = options
  const offset = options.offset ?? 32
  const active = ref(ids[0]) as Ref<T>
  let pinned: T | null = null
  let frame = 0

  function section(id: T): HTMLElement | null {
    return container.value?.querySelector<HTMLElement>(`#${CSS.escape(domId(id))}`) ?? null
  }

  function update(): void {
    frame = 0
    const root = container.value
    if (!root || ids.length === 0) return
    if (pinned) {
      active.value = pinned
      return
    }
    const atBottom =
      root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2
    if (atBottom) {
      active.value = ids[ids.length - 1]
      return
    }
    const top = root.getBoundingClientRect().top
    let current = ids[0]
    for (const id of ids) {
      const el = section(id)
      if (el && el.getBoundingClientRect().top - top <= offset + 1) current = id
    }
    active.value = current
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(update)
  }

  function unpin(): void {
    pinned = null
  }

  /** Jumps to a section (instantly) and focuses its heading for keyboard and screen readers. */
  function scrollTo(id: T): void {
    const root = container.value
    const el = section(id)
    if (!root || !el) return
    pinned = id
    active.value = id
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
    root.scrollTo({ top: Math.max(0, top - offset) })
    el.querySelector<HTMLElement>('[data-section-heading]')?.focus({ preventScroll: true })
  }

  useEventListener(container, 'scroll', schedule, { passive: true })
  for (const type of USER_SCROLL_EVENTS) {
    useEventListener(container, type, unpin, { passive: true })
  }
  useResizeObserver(container, schedule)
  onMounted(schedule)
  onBeforeUnmount(() => cancelAnimationFrame(frame))

  return { active, scrollTo }
}
