/**
 * Chat-like scrolling for the message list (fixed row height, newest row at the bottom).
 *
 * - While `follow` is on and the viewport is at the bottom, new rows are followed.
 * - Scrolled up, the first visible row (by message id) keeps its place: ring-buffer eviction at
 *   the head, a resume or a filter change never makes the content under the reader jump.
 * - User intent wins: wheel-up / keyboard-up release the bottom at once (before the browser
 *   reports the scroll, so a streaming list never fights the wheel), and holding the scrollbar
 *   suspends following.
 * - Hidden with `v-show` (zero height) the state is kept and restored when shown again.
 * - `unseen` counts rows that arrived after the viewport left the bottom and are still below it.
 *
 * Cost while following a flood (PERF-04): one layout per update.
 * - `tail` tells the list to render the newest rows itself, so it does not first render the
 *   rows at the old scroll position and then again after the virtualizer saw the scroll event.
 * - Jumping to the bottom writes `scrollTop` from the known content height (rows × row height)
 *   and reads nothing back; the scroll event it causes is recognized as programmatic and not
 *   measured.
 * - A user scroll is measured in the next animation frame, not inside the scroll event.
 *
 * This module is the logic (watchers and handlers, testable without a DOM);
 * `useStickToBottom` (./useStickToBottom) wires the handlers to the scroller's events and the
 * component lifecycle.
 */
import {
  computed,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef
} from 'vue'
import type { MqttMessage } from '@shared/models'
import { lowerBoundById, upperBoundById } from '../utils/message-index'

/** Distance from the bottom (px) that still counts as "at the bottom". */
const BOTTOM_THRESHOLD_PX = 4
/** After an upward intent, the viewport cannot count as "at the bottom" for this long. */
const RELEASE_GUARD_MS = 300

/** The scroller properties the logic reads and writes. */
export type ScrollerElement = Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>

export interface StickToBottomOptions {
  scroller: Readonly<Ref<ScrollerElement | null>>
  rows: Readonly<Ref<readonly MqttMessage[]>>
  rowHeight: number
  /** Follow new rows while at the bottom (auto-scroll). */
  follow: MaybeRefOrGetter<boolean>
  /** Runs a callback before the next paint (default `requestAnimationFrame`; for tests). */
  frame?: (callback: () => void) => void
}

export interface StickToBottom {
  atBottom: Readonly<ShallowRef<boolean>>
  /** Rows that arrived since the viewport left the bottom and are still below it. */
  unseen: ComputedRef<number>
  /** Rows below the viewport. */
  below: ComputedRef<number>
  /**
   * Following the newest rows (at the bottom, `follow` on, scrollbar not held): the list can
   * render the last rows of `rows` without waiting for the virtualizer's scroll event.
   */
  tail: ComputedRef<boolean>
  /** Height of the viewport in px (0 while hidden or before mount). */
  viewportHeight: Readonly<ShallowRef<number>>
  /** Jumps to the newest row (and follows again when `follow` is on). */
  scrollToBottom(): void
  /** The user moves up (keyboard): stop following right away. */
  release(): void
}

/** The scroller's DOM events and lifecycle hooks, wired by `useStickToBottom`. */
export interface StickToBottomHandlers {
  onScroll(): void
  onWheel(event: Pick<WheelEvent, 'deltaY'>): void
  /** `onScroller`: the pointer went down on the scroller itself (its scrollbar). */
  onPointerDown(onScroller: boolean): void
  /** `buttons` of a pointer move over the scroller (0 = released outside the window). */
  onPointerMove(buttons: number): void
  endDrag(): void
  onResize(): void
  onMounted(): void
}

interface Anchor {
  id: number
  /** Pixels between the top of the anchor row and the top of the viewport. */
  offset: number
}

function nextFrame(callback: () => void): void {
  requestAnimationFrame(() => callback())
}

/** The scrolling logic without DOM wiring (see the module comment). */
export function createStickToBottom(
  options: StickToBottomOptions
): StickToBottom & { handlers: StickToBottomHandlers } {
  const { scroller, rows, rowHeight } = options
  const frame = options.frame ?? nextFrame
  const atBottom = shallowRef(true)
  /** Index just past the last fully visible row. */
  const viewportEnd = shallowRef(0)
  /** Newest row id when the viewport left the bottom. */
  const seenId = shallowRef<number | null>(null)
  const viewportHeight = shallowRef(0)
  const dragging = shallowRef(false)

  let anchor: Anchor | null = null
  let hidden = false
  let guardUntil = 0
  let pendingFollow = false
  let pendingSeen: number | null = null
  /** A jump wrote `scrollTop`: its scroll event is not measured (cleared on the next frame). */
  let programmatic = false
  let measureQueued = false

  const tail = computed(() => toValue(options.follow) && atBottom.value && !dragging.value)

  function newestId(list: readonly MqttMessage[]): number | null {
    return list.length > 0 ? list[list.length - 1].id : null
  }

  function setAtBottom(value: boolean, newestSeen: number | null = newestId(rows.value)): void {
    if (value === atBottom.value) return
    seenId.value = value ? null : newestSeen
    atBottom.value = value
  }

  function anchorAt(top: number, list: readonly MqttMessage[]): Anchor | null {
    const index = Math.min(Math.floor(top / rowHeight), list.length - 1)
    return index >= 0 ? { id: list[index].id, offset: top - index * rowHeight } : null
  }

  function captureAnchor(el: ScrollerElement, list: readonly MqttMessage[]): void {
    anchor = anchorAt(el.scrollTop, list)
  }

  function applyAnchor(el: ScrollerElement): void {
    if (!anchor) return
    const target = lowerBoundById(rows.value, anchor.id) * rowHeight + anchor.offset
    if (Math.abs(el.scrollTop - target) >= 1) el.scrollTop = target
  }

  function measure(el: ScrollerElement, newestSeen?: number | null): void {
    const height = el.clientHeight
    viewportHeight.value = height
    const top = el.scrollTop
    viewportEnd.value = Math.floor((top + height) / rowHeight)
    const distance = el.scrollHeight - height - top
    if (distance > BOTTOM_THRESHOLD_PX) setAtBottom(false, newestSeen ?? undefined)
    else if (performance.now() >= guardUntil) setAtBottom(true)
  }

  /** To the bottom without reading layout: the browser clamps `scrollTop` to its maximum. */
  function jump(el: ScrollerElement): void {
    const list = rows.value
    const content = list.length * rowHeight
    if (!programmatic) {
      programmatic = true
      frame(() => {
        programmatic = false
      })
    }
    el.scrollTop = content
    anchor = anchorAt(Math.max(0, content - viewportHeight.value), list)
    viewportEnd.value = list.length
    setAtBottom(true)
  }

  function scrollToBottom(): void {
    guardUntil = 0
    const el = scroller.value
    if (el && !hidden) jump(el)
  }

  function release(): void {
    const el = scroller.value
    if (!el || hidden || rows.value.length * rowHeight <= viewportHeight.value) return
    guardUntil = performance.now() + RELEASE_GUARD_MS
    setAtBottom(false)
  }

  // Before the DOM changes: decide whether to follow, remember what the reader looks at.
  watch(
    rows,
    (_next, previous) => {
      pendingFollow = false
      pendingSeen = null
      const el = scroller.value
      if (!el || hidden) return
      pendingFollow = tail.value
      if (!pendingFollow) {
        captureAnchor(el, previous)
        pendingSeen = newestId(previous)
      }
    },
    { flush: 'pre' }
  )

  // After the DOM changed (new total height): follow or restore the anchor.
  watch(
    rows,
    () => {
      const el = scroller.value
      if (!el || hidden) return
      if (pendingFollow) jump(el)
      else {
        applyAnchor(el)
        measure(el, pendingSeen)
      }
    },
    { flush: 'post' }
  )

  function measureLater(): void {
    if (measureQueued) return
    measureQueued = true
    frame(() => {
      measureQueued = false
      const el = scroller.value
      if (!el || hidden || el.clientHeight === 0) return
      captureAnchor(el, rows.value)
      measure(el)
    })
  }

  function endDrag(): void {
    if (!dragging.value) return
    dragging.value = false
    const el = scroller.value
    if (el && !hidden) measure(el)
  }

  const handlers: StickToBottomHandlers = {
    onScroll() {
      if (hidden || programmatic) return
      measureLater()
    },
    onWheel(event) {
      if (event.deltaY < 0) release()
    },
    onPointerDown(onScroller) {
      if (onScroller) dragging.value = true
    },
    onPointerMove(buttons) {
      if (buttons === 0) endDrag()
    },
    endDrag,
    onResize() {
      const el = scroller.value
      if (!el) return
      const height = el.clientHeight
      viewportHeight.value = height
      if (height === 0) {
        hidden = true
        return
      }
      const wasHidden = hidden
      hidden = false
      if (tail.value || (wasHidden && anchor === null)) jump(el)
      else {
        if (wasHidden) applyAnchor(el)
        measure(el)
      }
    },
    onMounted() {
      const el = scroller.value
      if (!el) return
      viewportHeight.value = el.clientHeight
      if (viewportHeight.value === 0) hidden = true
      else jump(el)
    }
  }

  const below = computed(() => Math.max(0, rows.value.length - viewportEnd.value))

  const unseen = computed(() => {
    if (atBottom.value || seenId.value === null) return 0
    const list = rows.value
    const seen = upperBoundById(list, seenId.value)
    return Math.max(0, list.length - Math.max(seen, viewportEnd.value))
  })

  return { atBottom, unseen, below, tail, viewportHeight, scrollToBottom, release, handlers }
}
