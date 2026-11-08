<script setup lang="ts">
/**
 * Virtualized message history of a topic, newest first. While the list is scrolled down (or
 * auto-scroll is off) it stays anchored on what is shown as new messages arrive on top.
 * Keyboard on the focused list: ↑ ↓ PageUp PageDown End select, Home / Esc follow the latest.
 */
import { computed, ref, useId, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { PinIcon } from '@lucide/vue'
import type { MqttMessage, ViewFormat } from '@shared/models'
import { QosBadge } from '@/components/common'
import { useFormatters } from '@/composables/useFormatters'
import { previewOf } from '@/composables/usePayloadPreview'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'
import MessageTime from './MessageTime.vue'

const ROW_HEIGHT = 28
const PREVIEW_CHARS = 200

const props = defineProps<{
  /** Oldest first (as kept by the store). */
  messages: readonly MqttMessage[]
  /** Pinned message id, `null` = following the newest. */
  selectedId: number | null
  format: ViewFormat
  /** Changing it (e.g. another topic) scrolls back to the top. */
  resetKey: string
}>()

const emit = defineEmits<{
  select: [id: number]
  follow: []
}>()

const settings = useSettingsStore()
const fmt = useFormatters()
const uid = useId()
const scroller = ref<HTMLElement | null>(null)

/** Message at a display position (0 = newest). */
const at = (index: number): MqttMessage | undefined =>
  props.messages[props.messages.length - 1 - index]

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.messages.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index: number) => at(index)?.id ?? index
  }))
)

/** Display position of the highlighted row (-1 when the pinned message is gone). */
const activeIndex = computed(() => {
  const list = props.messages
  if (list.length === 0) return -1
  if (props.selectedId === null) return 0
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].id === props.selectedId) return list.length - 1 - i
  }
  return -1
})

const visible = computed(() =>
  virtualizer.value.getVirtualItems().flatMap((item) => {
    const message = at(item.index)
    return message
      ? [{ item, message, preview: previewOf(message, props.format, PREVIEW_CHARS) }]
      : []
  })
)

const rowId = (index: number): string => `${uid}-message-${index}`
const activeId = computed(() =>
  visible.value.some(({ item }) => item.index === activeIndex.value)
    ? rowId(activeIndex.value)
    : undefined
)

function choose(index: number): void {
  const message = at(index)
  if (message) emit('select', message.id)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const count = props.messages.length
  if (count === 0) return
  if (event.key === 'Escape' || event.key === 'Home') {
    if (event.key === 'Escape' && props.selectedId === null) return
    event.preventDefault()
    emit('follow')
    virtualizer.value.scrollToIndex(0)
    return
  }
  const current = Math.max(0, activeIndex.value)
  const page = Math.max(1, Math.floor((scroller.value?.clientHeight ?? 280) / ROW_HEIGHT) - 1)
  const targets: Readonly<Record<string, number>> = {
    ArrowDown: current + 1,
    ArrowUp: current - 1,
    PageDown: current + page,
    PageUp: current - page,
    End: count - 1
  }
  const target = targets[event.key]
  if (target === undefined) return
  event.preventDefault()
  const index = Math.min(count - 1, Math.max(0, target))
  choose(index)
  virtualizer.value.scrollToIndex(index, { align: 'auto' })
}

// Keep the rows in view when new messages are prepended (unless following the top live).
watch(
  () => props.messages,
  (next, previous) => {
    const element = scroller.value
    if (!element || previous.length === 0 || next.length === 0) return
    if (element.scrollTop < ROW_HEIGHT / 2 && settings.settings.autoScroll) return
    const newest = previous[previous.length - 1]
    let added = 0
    for (let i = next.length - 1; i >= 0 && next[i].id !== newest.id; i--) added++
    if (added > 0 && added < next.length) element.scrollTop += added * ROW_HEIGHT
  },
  { flush: 'post' }
)

watch(
  () => props.resetKey,
  () => {
    if (scroller.value) scroller.value.scrollTop = 0
  }
)
</script>

<template>
  <div
    ref="scroller"
    role="listbox"
    tabindex="0"
    aria-label="Message history, newest first"
    :aria-activedescendant="activeId"
    class="group/history h-full overflow-x-hidden overflow-y-auto outline-none scrollbar-slim focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    @keydown="onKeydown"
  >
    <div class="relative w-full" :style="{ height: `${virtualizer.getTotalSize()}px` }">
      <div
        v-for="{ item, message, preview } in visible"
        :id="rowId(item.index)"
        :key="message.id"
        role="option"
        :aria-selected="item.index === activeIndex"
        :class="
          cn(
            'absolute top-0 left-0 flex h-7 w-full cursor-default items-center gap-2.5 pr-3 pl-3 text-xs',
            item.index === activeIndex
              ? 'bg-primary/10 dark:bg-primary/15'
              : 'hover:bg-muted/70 dark:hover:bg-muted/50'
          )
        "
        :style="{ transform: `translateY(${item.start}px)` }"
        @click="choose(item.index)"
      >
        <span
          v-if="item.index === activeIndex"
          class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
          aria-hidden="true"
        />
        <MessageTime :timestamp="message.timestamp" class="shrink-0 text-foreground/90" />
        <span
          class="w-14 shrink-0 text-right font-mono text-muted-foreground tabular-nums"
          :title="`${message.payload.length} bytes`"
          >{{ fmt.bytes(message.payload.length) }}</span
        >
        <QosBadge :qos="message.qos" :tooltip="false" />
        <span v-if="message.retain" class="flex shrink-0 text-muted-foreground" title="Retained">
          <PinIcon class="size-3" aria-hidden="true" />
          <span class="sr-only">retained</span>
        </span>
        <span v-if="preview" class="min-w-0 flex-1 truncate font-mono text-muted-foreground">{{
          preview
        }}</span>
        <span v-else class="min-w-0 flex-1 truncate text-muted-foreground italic">
          Empty payload
        </span>
      </div>
    </div>
  </div>
</template>
