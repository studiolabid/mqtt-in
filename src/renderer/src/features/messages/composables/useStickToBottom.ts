/**
 * Chat-like scrolling for the message list: `createStickToBottom` (./stick-to-bottom, the logic
 * and its rules) wired to the scroller element's events and the component lifecycle.
 */
import { onMounted, type Ref } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import {
  createStickToBottom,
  type StickToBottom,
  type StickToBottomOptions
} from './stick-to-bottom'

export {
  createStickToBottom,
  type ScrollerElement,
  type StickToBottom,
  type StickToBottomHandlers,
  type StickToBottomOptions
} from './stick-to-bottom'

export interface UseStickToBottomOptions extends StickToBottomOptions {
  scroller: Readonly<Ref<HTMLElement | null>>
}

/** `createStickToBottom` wired to the scroller element and the component lifecycle. */
export function useStickToBottom(options: UseStickToBottomOptions): StickToBottom {
  const { handlers, ...stick } = createStickToBottom(options)
  const { scroller } = options
  const passive = { passive: true }

  useEventListener(scroller, 'scroll', handlers.onScroll, passive)
  useEventListener(scroller, 'wheel', (event: WheelEvent) => handlers.onWheel(event), passive)
  // Holding the scrollbar (the scroller itself is the target) suspends following.
  useEventListener(
    scroller,
    'pointerdown',
    (event: PointerEvent) => handlers.onPointerDown(event.target === scroller.value),
    passive
  )
  useEventListener(
    window,
    ['pointerup', 'pointercancel', 'mouseup', 'blur'],
    handlers.endDrag,
    passive
  )
  useEventListener(
    scroller,
    'pointermove',
    (event: PointerEvent) => handlers.onPointerMove(event.buttons),
    passive
  )
  useResizeObserver(scroller, handlers.onResize)
  onMounted(handlers.onMounted)

  return stick
}
