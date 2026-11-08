<script setup lang="ts">
/**
 * Vertical 1 px separator between the sidebar and the content that resizes the sidebar:
 * drag (far left collapses), arrow keys (Shift = bigger steps), Home / End, Enter collapses,
 * double-click restores the default width. Keyboard focus shows a 3 px band in the ring color
 * (a recolored 1 px line was too faint to find, A11Y-01).
 */
import { ref } from 'vue'

const props = defineProps<{
  width: number
  min: number
  max: number
}>()

const emit = defineEmits<{
  /** Live width while dragging. */
  resize: [width: number]
  /** Final width (drag end, keyboard). */
  commit: [width: number]
  collapse: []
  reset: []
}>()

/** Dragging this far below the minimum collapses the sidebar. */
const COLLAPSE_OVERSHOOT = 72
const KEY_STEP = 16

const dragging = ref(false)
let startX = 0
let startWidth = 0
let latest = 0

function clamp(width: number): number {
  return Math.min(props.max, Math.max(props.min, Math.round(width)))
}

function release(event: PointerEvent): void {
  dragging.value = false
  const target = event.currentTarget
  if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
  }
  startX = event.clientX
  startWidth = props.width
  latest = props.width
  dragging.value = true
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const raw = startWidth + event.clientX - startX
  if (raw < props.min - COLLAPSE_OVERSHOOT) {
    release(event)
    // Reopening restores the width the drag started from.
    emit('commit', startWidth)
    emit('collapse')
    return
  }
  latest = clamp(raw)
  emit('resize', latest)
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return
  release(event)
  emit('commit', latest)
}

function onLostCapture(): void {
  if (!dragging.value) return
  dragging.value = false
  emit('commit', latest)
}

function onKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP
  let next: number
  switch (event.key) {
    case 'ArrowLeft':
      next = props.width - step
      break
    case 'ArrowRight':
      next = props.width + step
      break
    case 'Home':
      next = props.min
      break
    case 'End':
      next = props.max
      break
    case 'Enter':
      event.preventDefault()
      emit('collapse')
      return
    default:
      return
  }
  event.preventDefault()
  emit('commit', clamp(next))
}
</script>

<template>
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    aria-controls="app-sidebar"
    :aria-valuenow="width"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    :data-dragging="dragging || undefined"
    class="relative z-10 w-px shrink-0 cursor-col-resize touch-none bg-border transition-colors outline-none after:absolute after:inset-y-0 after:-right-1 after:-left-1 hover:bg-primary/60 hover:delay-200 focus-visible:bg-ring focus-visible:shadow-[0_0_0_1px_var(--ring)] data-dragging:bg-primary data-dragging:delay-0"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @lostpointercapture="onLostCapture"
    @dblclick="emit('reset')"
    @keydown="onKeydown"
  />
</template>
