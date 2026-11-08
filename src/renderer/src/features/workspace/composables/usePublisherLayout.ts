/**
 * The publisher panel of the workspace (bottom of the vertical split): collapse / expand, the
 * remembered height and fitting to the room it has.
 *
 * - The collapsed state is read from reka-ui's own `isCollapsed` (the panel's `data-state`).
 *   reka-ui never calls `onCollapse` / `onExpand` for px panels (it compares converted pixel
 *   sizes with floating-point noise), so those events are not used (UX-01).
 * - The user's choices are remembered: a toggle (button, double click / Enter on the handle,
 *   "Edit & publish" revealing it) and the end of a resize gesture (drag, arrow keys).
 * - Window resizes and zoom refit the publisher (`publisherHeightFor`): capped so the messages
 *   keep their room, collapsed while not even the minimums fit, and reopened when they fit again.
 *   Fitting never changes the remembered height or the user's collapsed choice (A11Y-07).
 */
import { computed, onBeforeUnmount, watch, type ComputedRef, type Ref } from 'vue'
import { useElementSize, type MaybeElementRef } from '@vueuse/core'
import {
  initialPublishHeight,
  isPublisherCollapsed,
  PUBLISH_HEIGHT,
  publisherHeightFor,
  rememberWorkspaceLayout,
  workspaceLayout
} from '../utils/layout'

/** What the layout needs of reka-ui's `SplitterPanel` (its exposed API, sizes in px). */
export interface PublisherPanelApi {
  collapse(): void
  resize(size: number): void
  getSize(): number
  readonly isCollapsed: boolean
}

export interface PublisherLayoutOptions {
  /** The publisher's `SplitterPanel` (template ref). */
  panel: Readonly<Ref<PublisherPanelApi | null>>
  /** The vertical panel group (template ref): its height is what both panels share. */
  group: MaybeElementRef
  /** Bumps when another feature asks for the publisher ("Edit & publish"). */
  revealRequest: () => number
}

export interface PublisherLayout {
  /** Initial size of the panel (px). */
  defaultSize: number
  /** The publisher shows only its header. */
  collapsed: ComputedRef<boolean>
  /** Collapses, or expands to the remembered height (fitted to the window). */
  toggle(): void
  /** `@dragging` of the resize handle: a finished drag is the user's new height. */
  onHandleDragging(dragging: boolean): void
  /** `@keyup` of the resize handle: arrow / Home / End resizes are the user's new height. */
  onHandleKeyup(event: KeyboardEvent): void
}

const RESIZE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End'])

export function usePublisherLayout(options: PublisherLayoutOptions): PublisherLayout {
  const stored = workspaceLayout()
  let remembered = stored.publishHeight
  /** The user's choice (persisted); fitting never changes it. */
  let userCollapsed = stored.publishCollapsed
  const initial = initialPublishHeight(remembered, window.innerHeight)
  /** Collapsed by fitting (not by the user): reopens once there is room. */
  let autoCollapsed = !userCollapsed && initial === 'collapsed'
  /** Whether the last measured group could hold the publisher. */
  let roomy = initial !== 'collapsed'
  const defaultSize = userCollapsed || initial === 'collapsed' ? PUBLISH_HEIGHT.collapsed : initial

  const { height: groupHeight } = useElementSize(options.group)

  const collapsed = computed(
    () => options.panel.value?.isCollapsed ?? isPublisherCollapsed(defaultSize)
  )

  function setUserCollapsed(value: boolean): void {
    autoCollapsed = false
    if (userCollapsed === value) return
    userCollapsed = value
    rememberWorkspaceLayout({ publishCollapsed: value })
  }

  /** The height to open at: the remembered one, fitted to the measured group. */
  function openHeight(): number {
    const height = groupHeight.value
    if (height <= 0) return Math.max(PUBLISH_HEIGHT.min, remembered)
    const fitted = publisherHeightFor(height, remembered)
    // The user asked for it although it does not fit: open at the minimum.
    return fitted === 'collapsed' ? PUBLISH_HEIGHT.min : fitted
  }

  function expand(): void {
    setUserCollapsed(false)
    options.panel.value?.resize(openHeight())
  }

  function toggle(): void {
    if (collapsed.value) {
      expand()
      return
    }
    setUserCollapsed(true)
    options.panel.value?.collapse()
  }

  // "Edit & publish" and friends: reveal a collapsed publisher.
  watch(options.revealRequest, () => {
    if (collapsed.value) expand()
  })

  /** A resize gesture ended: its size is the user's choice. */
  function commitUserSize(): void {
    const size = options.panel.value?.getSize()
    if (size === undefined || !Number.isFinite(size)) return
    if (isPublisherCollapsed(size)) {
      setUserCollapsed(true)
      return
    }
    setUserCollapsed(false)
    remembered = Math.round(size)
    rememberWorkspaceLayout({ publishHeight: remembered })
  }

  function onHandleDragging(dragging: boolean): void {
    if (!dragging) commitUserSize()
  }

  function onHandleKeyup(event: KeyboardEvent): void {
    if (RESIZE_KEYS.has(event.key)) commitUserSize()
  }

  /** Fits the publisher to a new group height (window resize, zoom). */
  function fit(height: number): void {
    const panel = options.panel.value
    if (!panel || height <= 0) return
    const target = publisherHeightFor(height, remembered)
    const wasRoomy = roomy
    roomy = target !== 'collapsed'
    if (userCollapsed) return
    if (target === 'collapsed') {
      // Collapse once when the room runs out; an explicit "show" afterwards is respected.
      if (wasRoomy && !panel.isCollapsed) {
        autoCollapsed = true
        panel.collapse()
      }
      return
    }
    if (panel.isCollapsed) {
      if (autoCollapsed) {
        autoCollapsed = false
        panel.resize(target)
      }
      return
    }
    if (Math.abs(panel.getSize() - target) >= 1) panel.resize(target)
  }

  // A frame later, so reka-ui has applied the new group size to its own layout first.
  let frame = 0
  watch(groupHeight, (height) => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => fit(height))
  })
  onBeforeUnmount(() => cancelAnimationFrame(frame))

  return { defaultSize, collapsed, toggle, onHandleDragging, onHandleKeyup }
}
