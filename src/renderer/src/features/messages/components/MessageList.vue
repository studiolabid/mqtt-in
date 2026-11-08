<script setup lang="ts">
/**
 * Virtualized live message stream, newest at the bottom (chat-like, see `useStickToBottom`).
 *
 * Click selects (opens the detail), the keyboard works on the focused list (see
 * `useListKeyboard`). One ContextMenu serves every row: the row under the pointer is resolved
 * on `contextmenu` and outlined while the menu is open. Hover actions exist for one row only.
 *
 * Rendering (PERF-04): rows are keyed by their slot in the rendered window, so a live update
 * patches the same row elements instead of remounting every one of them. While the list follows
 * the newest messages, the window is simply the tail of the rows (the virtualizer only learns
 * the new scroll position one scroll event later). Each row carries its position in the whole
 * list (`aria-posinset` / `aria-setsize`): only a window of the rows is in the DOM.
 */
import { computed, ref, shallowRef } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { MqttMessage } from '@shared/models'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import type { MessageList } from '@/composables'
import { useSubscriptionsStore, useUiStore } from '@/stores'
import { useListKeyboard } from '../composables/useListKeyboard'
import { useMessageActions } from '../composables/useMessageActions'
import { useRowHover } from '../composables/useRowHover'
import { useStickToBottom } from '../composables/useStickToBottom'
import { MESSAGE_ROW_HEIGHT as ROW, type RowAction } from '../types'
import { indexOfId } from '../utils/message-index'
import MessageContextItems from './MessageContextItems.vue'
import MessageRow from './MessageRow.vue'
import NewMessagesPill from './NewMessagesPill.vue'

/** Rows rendered above and below the viewport. */
const OVERSCAN = 10

const props = defineProps<{
  connectionId: string
  list: MessageList
  /** Follow new messages while at the bottom. */
  autoScroll: boolean
  /** Search term to mark in topics and previews. */
  highlight: string
}>()

const ui = useUiStore()
const subscriptions = useSubscriptionsStore()
const actions = useMessageActions(() => props.connectionId)

const scroller = ref<HTMLElement | null>(null)
const rows = computed(() => props.list.rows.value)
const selectedId = computed(() => ui.selectedMessageId(props.connectionId))
const format = computed(() => ui.viewFormat(props.connectionId))
const menuMessage = shallowRef<MqttMessage | null>(null)
const menuTargetId = ref<number | null>(null)
/** Row and position at `pointerdown` (rows may move before the click under load). */
let pressed: { id: number | null; x: number; y: number } | null = null

const virtualizer = useVirtualizer<HTMLElement, HTMLElement>(
  computed(() => {
    const count = rows.value.length
    return {
      count,
      getScrollElement: () => scroller.value,
      estimateSize: () => ROW,
      overscan: OVERSCAN,
      initialOffset: () => count * ROW
    }
  })
)

const stick = useStickToBottom({
  scroller,
  rows,
  rowHeight: ROW,
  follow: () => props.autoScroll
})
const { atBottom, unseen, below, scrollToBottom, release } = stick

/** Indexes `[start, end)` of the rendered rows. */
const range = computed(() => {
  const count = rows.value.length
  const viewport = stick.viewportHeight.value
  if (stick.tail.value && viewport > 0) {
    // Following: the newest rows, like the virtualizer's range at the bottom.
    return { start: Math.max(0, count - Math.ceil(viewport / ROW) - OVERSCAN), end: count }
  }
  const items = virtualizer.value.getVirtualItems()
  if (items.length === 0) return { start: 0, end: 0 }
  return { start: items[0].index, end: Math.min(count, items[items.length - 1].index + 1) }
})
const totalSize = computed(() => rows.value.length * ROW)
const offsetTop = computed(() => range.value.start * ROW)
const visible = computed(() => rows.value.slice(range.value.start, range.value.end))

const { hoveredId, onPointerMove, onPointerLeave } = useRowHover({ scroller, rows, rowHeight: ROW })
const showPill = computed(() => !atBottom.value && (unseen.value > 0 || below.value > 0))

const onKeydown = useListKeyboard({
  scroller,
  rows,
  rowHeight: ROW,
  selectedId,
  select: (id) => ui.selectMessage(props.connectionId, id),
  reveal(index) {
    if (index === rows.value.length - 1) scrollToBottom()
    else virtualizer.value.scrollToIndex(index, { align: 'auto' })
  },
  release,
  copyPayload: (message) => void actions.copyPayload(message),
  copyTopic: (message) => void actions.copyTopic(message)
})

function domId(id: number): string {
  return `mqtey-message-${id}`
}

const activeDescendant = computed(() => {
  const id = selectedId.value
  return id !== null && visible.value.some((message) => message.id === id) ? domId(id) : undefined
})

/** The color of the subscription that delivered the message (its identifier first). */
function colorOf(message: MqttMessage): string | undefined {
  return message.direction === 'in'
    ? subscriptions.colorForMessage(props.connectionId, message)
    : undefined
}

function rowIdOf(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null
  const value = target.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
  return value === undefined ? null : Number(value)
}

function onPointerDown(event: PointerEvent): void {
  pressed =
    event.button === 0 ? { id: rowIdOf(event.target), x: event.clientX, y: event.clientY } : null
}

/** A text selection inside the list. */
function selectingText(): boolean {
  const selection = window.getSelection()
  const el = scroller.value
  if (!selection || selection.isCollapsed || !selection.toString() || !el) return false
  return selection.anchorNode !== null && el.contains(selection.anchorNode)
}

function onClick(event: MouseEvent): void {
  const press = pressed
  pressed = null
  const id = press?.id ?? rowIdOf(event.target)
  // Dragging over a topic to select text is not a click on the row.
  const moved = !!press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4
  if (id === null || (moved && selectingText())) return
  ui.selectMessage(props.connectionId, id)
}

function onContextMenu(event: MouseEvent): void {
  // The keyboard context-menu key targets the focused list itself: use the selected row.
  const id = rowIdOf(event.target) ?? (event.target === scroller.value ? selectedId.value : null)
  const index = id === null ? -1 : indexOfId(rows.value, id)
  if (index === -1) {
    event.preventDefault()
    return
  }
  menuMessage.value = rows.value[index]
  menuTargetId.value = rows.value[index].id
}

function onMenuOpen(open: boolean): void {
  if (!open) menuTargetId.value = null
}

function onRowAction(message: MqttMessage, action: RowAction): void {
  if (action === 'copy-payload') void actions.copyPayload(message)
  else if (action === 'copy-topic') void actions.copyTopic(message)
  else actions.editAndPublish(message)
}

function jumpToLatest(): void {
  scrollToBottom()
  scroller.value?.focus({ preventScroll: true })
}

defineExpose({
  /** Moves keyboard focus to the list. */
  focus: (): void => scroller.value?.focus({ preventScroll: true })
})
</script>

<template>
  <div class="@container/list relative flex h-full min-h-0 flex-col bg-background">
    <ContextMenu @update:open="onMenuOpen">
      <!-- The trigger wraps the scroller: rows resolve their message before the menu opens. -->
      <ContextMenuTrigger as-child>
        <div class="flex min-h-0 flex-1 flex-col">
          <div
            ref="scroller"
            data-testid="message-list"
            role="listbox"
            aria-label="Messages"
            :aria-activedescendant="activeDescendant"
            :aria-busy="list.pending.value || undefined"
            tabindex="0"
            class="group/list min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-slim outline-none [overflow-anchor:none] focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring"
            @keydown="onKeydown"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerleave="onPointerLeave"
            @click="onClick"
            @contextmenu="onContextMenu"
          >
            <div class="relative w-full" :style="{ height: `${totalSize}px` }">
              <div
                class="absolute inset-x-0 top-0"
                :style="{ transform: `translateY(${offsetTop}px)` }"
              >
                <MessageRow
                  v-for="(message, slot) in visible"
                  :key="slot"
                  :message="message"
                  :dom-id="domId(message.id)"
                  :position="range.start + slot + 1"
                  :set-size="rows.length"
                  :format="format"
                  :color="colorOf(message)"
                  :highlight="highlight"
                  :selected="message.id === selectedId"
                  :hovered="message.id === hoveredId"
                  :menu-target="message.id === menuTargetId"
                  @action="(action) => onRowAction(message, action)"
                />
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-60">
        <MessageContextItems
          v-if="menuMessage"
          :connection-id="connectionId"
          :message="menuMessage"
        />
      </ContextMenuContent>
    </ContextMenu>

    <div
      v-if="list.paused.value"
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-warning/70"
    />
    <NewMessagesPill v-if="showPill" :count="unseen" @jump="jumpToLatest" />
  </div>
</template>
