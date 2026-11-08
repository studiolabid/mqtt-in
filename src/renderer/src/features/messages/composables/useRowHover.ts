/**
 * The row under the mouse, computed from the pointer position (fixed row height) instead of
 * `pointerover`: it stays correct while rows stream under a still pointer or the list scrolls.
 * Hover actions are rendered for that one row only.
 *
 * A pointer move reads the layout right away (input events arrive with a clean layout). A scroll
 * or a rows update re-reads it in the next animation frame instead, so a streaming list never
 * forces an extra synchronous layout (PERF-04); nothing is read while the pointer is elsewhere.
 */
import { shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { MqttMessage } from '@shared/models'

export interface RowHoverOptions {
  scroller: Readonly<Ref<HTMLElement | null>>
  rows: Readonly<Ref<readonly MqttMessage[]>>
  rowHeight: number
}

export interface RowHover {
  hoveredId: Readonly<ShallowRef<number | null>>
  onPointerMove(event: PointerEvent): void
  onPointerLeave(): void
}

export function useRowHover(options: RowHoverOptions): RowHover {
  const { scroller, rows, rowHeight } = options
  const hoveredId = shallowRef<number | null>(null)
  /** Last mouse position (client coordinates) while over the list. */
  let pointer: { x: number; y: number } | null = null
  let queued = false

  function update(): void {
    const el = scroller.value
    let id: number | null = null
    if (el && pointer) {
      const rect = el.getBoundingClientRect()
      const x = pointer.x - rect.left
      const y = pointer.y - rect.top
      // `clientWidth` excludes the scrollbar: no row is hovered while on it.
      if (x >= 0 && x < el.clientWidth && y >= 0 && y < el.clientHeight) {
        id = rows.value[Math.floor((el.scrollTop + y) / rowHeight)]?.id ?? null
      }
    }
    if (id !== hoveredId.value) hoveredId.value = id
  }

  /** Re-reads in the next frame (coalesced); only while the pointer is over the list. */
  function updateLater(): void {
    if (!pointer || queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      update()
    })
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return
    pointer = { x: event.clientX, y: event.clientY }
    update()
  }

  function onPointerLeave(): void {
    pointer = null
    update()
  }

  useEventListener(scroller, 'scroll', updateLater, { passive: true })
  watch(rows, updateLater, { flush: 'post' })

  return { hoveredId, onPointerMove, onPointerLeave }
}
