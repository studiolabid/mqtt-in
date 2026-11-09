<script setup lang="ts">
/**
 * One message in the virtualized list (fixed 52 px, two lines): subscription color strip,
 * direction, topic + flags + time / size, and a one-line payload preview (computed only for
 * rendered rows, cached per message).
 *
 * The list keys rows by their slot in the rendered window, so a row is patched with the next
 * message instead of being remounted: the row keeps no state of its own. `position` and
 * `setSize` describe its place in the whole (virtualized) list for screen readers.
 */
import { computed } from 'vue'
import { ArrowDownLeftIcon, ArrowUpRightIcon } from '@lucide/vue'
import type { MqttMessage, ViewFormat } from '@shared/models'
import { HighlightText, JsonInline, QosBadge, RelativeTime, TopicLabel } from '@/components/common'
import { useFormatters, usePayloadPreview } from '@/composables'
import { useSettingsStore } from '@/stores'
import type { RowAction } from '../types'
import MessageRowActions from './MessageRowActions.vue'

const props = defineProps<{
  message: MqttMessage
  /** DOM id (for `aria-activedescendant`). */
  domId: string
  /** 1-based position in the whole list (`aria-posinset`). */
  position: number
  /** Rows in the whole list (`aria-setsize`). */
  setSize: number
  format: ViewFormat
  /** Subscription color (incoming rows). */
  color?: string
  /** Search term to mark. */
  highlight: string
  selected: boolean
  hovered: boolean
  /** The row's context menu is open. */
  menuTarget?: boolean
  /** Hide the QoS badge (WebSocket / Socket.IO messages have no QoS). */
  noQos?: boolean
}>()

const emit = defineEmits<{ action: [action: RowAction] }>()

const settings = useSettingsStore()
const fmt = useFormatters()
const { previewOf } = usePayloadPreview()

const incoming = computed(() => props.message.direction === 'in')
const preview = computed(() => previewOf(props.message, props.format))
const json = computed(() => {
  const first = preview.value[0]
  return first === '{' || first === '['
})
const relative = computed(() => settings.settings.timestampFormat === 'relative')
const iso = computed(() => new Date(props.message.timestamp).toISOString())
const stripStyle = computed(() =>
  incoming.value && props.color ? { backgroundColor: props.color } : undefined
)
</script>

<template>
  <div
    :id="domId"
    role="option"
    :aria-selected="selected"
    :aria-posinset="position"
    :aria-setsize="setSize"
    data-testid="message-row"
    :data-message-id="message.id"
    :data-topic="message.topic"
    :data-direction="message.direction"
    :data-selected="selected ? '' : undefined"
    :data-menu-target="menuTarget ? '' : undefined"
    class="message-row relative flex h-[52px] items-stretch gap-2.5 border-b border-border/60 pr-3 pl-3.5 data-selected:ring-1 data-selected:ring-foreground/40 data-selected:ring-inset data-menu-target:outline-1 data-menu-target:-outline-offset-1 data-menu-target:outline-ring"
  >
    <span
      aria-hidden="true"
      class="absolute inset-y-0 left-0 w-[3px]"
      :class="incoming ? (color ? undefined : 'bg-muted-foreground/25') : 'bg-outgoing/70'"
      :style="stripStyle"
    />
    <!-- Selection bar next to the subscription color (which stays visible). -->
    <span
      v-if="selected"
      aria-hidden="true"
      class="absolute inset-y-0 left-[3px] w-0.5 bg-foreground"
    />
    <span class="flex w-3.5 shrink-0 pt-[9px]" :title="incoming ? 'Incoming' : 'Outgoing'">
      <ArrowDownLeftIcon v-if="incoming" class="size-3.5 text-incoming" aria-hidden="true" />
      <ArrowUpRightIcon v-else class="size-3.5 text-outgoing" aria-hidden="true" />
      <span class="sr-only">{{ incoming ? 'Incoming' : 'Outgoing' }}</span>
    </span>

    <div class="flex min-w-0 flex-1 flex-col justify-center gap-[3px]">
      <div class="flex h-[18px] min-w-0 items-center gap-1.5">
        <TopicLabel
          :topic="message.topic"
          :highlight="highlight"
          class="min-w-0 text-xs font-medium"
        />
        <QosBadge v-if="!noQos" :qos="message.qos" :tooltip="false" />
        <span
          v-if="message.retain"
          class="inline-flex h-4 shrink-0 items-center rounded-[4px] bg-info/10 px-1 font-mono text-[10px] leading-none font-semibold text-info"
          title="Retained message"
          ><span aria-hidden="true">R</span><span class="sr-only">Retained</span></span
        >
        <span
          v-if="message.dup"
          class="inline-flex h-4 shrink-0 items-center rounded-[4px] bg-warning/15 px-1 font-mono text-[10px] leading-none font-semibold text-warning"
          title="Duplicate delivery (DUP flag)"
          ><span aria-hidden="true">DUP</span><span class="sr-only">Duplicate delivery</span></span
        >
        <!-- A narrow list keeps the topic readable: time and size are in the detail. -->
        <span
          class="ml-auto hidden shrink-0 items-center gap-2.5 pl-2 font-mono text-[11px] text-muted-foreground tabular-nums @2xs/list:flex"
        >
          <RelativeTime v-if="relative" :timestamp="message.timestamp" />
          <time v-else :datetime="iso">{{ fmt.time(message.timestamp) }}</time>
          <span class="hidden w-14 text-right @md/list:inline">{{
            fmt.bytes(message.payload.length)
          }}</span>
        </span>
      </div>
      <div class="h-4 min-w-0 truncate font-mono text-xs leading-4 text-muted-foreground">
        <span v-if="message.payload.length === 0" class="italic">Empty payload</span>
        <span v-else-if="!preview" class="italic">Whitespace only</span>
        <HighlightText v-else-if="highlight" :text="preview" :terms="highlight" :max-marks="12" />
        <JsonInline v-else-if="json" :text="preview" />
        <template v-else>{{ preview }}</template>
      </div>
    </div>

    <MessageRowActions v-if="hovered" @action="(action) => emit('action', action)" />
  </div>
</template>

<style scoped>
.message-row {
  background-color: var(--background);
}
.message-row:hover {
  background-color: color-mix(in oklab, var(--muted) 62%, var(--background));
}
.message-row[data-selected] {
  background-color: var(--accent);
}
</style>
