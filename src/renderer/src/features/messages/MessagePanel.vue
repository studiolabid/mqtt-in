<script setup lang="ts">
/**
 * Messages tab of a connection workspace: toolbar, virtualized live stream (newest at the
 * bottom) and, while a message is selected, its detail in a resizable pane on the right.
 * Every piece of per-connection state lives in the stores, so remounting is free.
 *
 * It also answers export requests made elsewhere (`ui.requestMessageExport`, e.g. the command
 * palette's "Export messages as JSON/CSV…"): the filtered messages while a filter is active,
 * every message in memory otherwise.
 */
import { computed, nextTick, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import { isMqttProfile } from '@shared/connection-kind'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useMessageList, useThrottledValue } from '@/composables'
import {
  useConnectionsStore,
  useMessagesStore,
  useSessionsStore,
  useSubscriptionsStore,
  useUiStore
} from '@/stores'
import { isMessageFilterActive } from '@/utils/message-filter'
import MessageDetail from './components/MessageDetail.vue'
import MessageEmptyState from './components/MessageEmptyState.vue'
import MessageList from './components/MessageList.vue'
import MessageToolbar from './components/MessageToolbar.vue'
import { useAutoScroll } from './composables/useAutoScroll'
import { useExportRequests, useMessageExport } from './composables/useMessageExport'
import type { MessageEmptyKind } from './types'
import { messageEmptyKind } from './utils/empty-kind'

const props = defineProps<{ connectionId: string }>()

const ui = useUiStore()
const sessions = useSessionsStore()
const subscriptions = useSubscriptionsStore()
const connections = useConnectionsStore()
const messages = useMessagesStore()

const list = useMessageList(
  () => props.connectionId,
  () => ui.messageFilter(props.connectionId)
)
const autoScroll = useAutoScroll(() => props.connectionId)
const root = ref<HTMLElement | null>(null)
const listView = ref<InstanceType<typeof MessageList> | null>(null)

/** The detail needs ~300 px to be useful: its minimum (in %) follows the panel width. */
const { width } = useElementSize(root)
const detailMin = computed(() =>
  width.value > 0 ? Math.round(Math.min(55, Math.max(22, (300 / width.value) * 100))) : 24
)
const detailDefault = computed(() => Math.max(38, detailMin.value))

const filter = computed(() => ui.messageFilter(props.connectionId))
const highlight = computed(() => filter.value.search.trim())
const selectedId = computed(() => ui.selectedMessageId(props.connectionId))
const total = useThrottledValue(() => list.total.value, 250)

const mqtt = computed(() => {
  const profile = connections.get(props.connectionId)
  return !profile || isMqttProfile(profile)
})

const emptyKind = computed<MessageEmptyKind | null>(() =>
  messageEmptyKind({
    rows: list.rows.value.length,
    total: list.total.value,
    status: sessions.statusOf(props.connectionId),
    // WebSocket / Socket.IO connections receive everything without subscriptions.
    listening: !mqtt.value || subscriptions.list(props.connectionId).some((sub) => sub.enabled),
    filterActive: isMessageFilterActive(filter.value),
    pending: list.pending.value,
    paused: list.paused.value
  })
)

const exporter = useMessageExport(() => props.connectionId)
useExportRequests(
  () => props.connectionId,
  (format) => {
    const rows = isMessageFilterActive(filter.value)
      ? list.rows.value
      : messages.messages(props.connectionId)
    void exporter.exportMessages(format, rows)
  }
)

function closeDetail(): void {
  ui.selectMessage(props.connectionId, null)
  void nextTick(() => listView.value?.focus())
}
</script>

<template>
  <section
    ref="root"
    data-testid="message-panel"
    aria-label="Messages"
    class="flex h-full min-h-0 min-w-0 flex-col bg-background"
  >
    <MessageToolbar :connection-id="connectionId" :list="list" />
    <ResizablePanelGroup
      direction="horizontal"
      auto-save-id="mqtt-in-messages-detail"
      class="min-h-0 flex-1"
    >
      <ResizablePanel id="messages-list" :order="1" :min-size="30" class="min-w-0">
        <!-- Kept mounted (scroll state survives empty states; it restores when shown). -->
        <MessageList
          v-show="!emptyKind"
          ref="listView"
          :connection-id="connectionId"
          :list="list"
          :auto-scroll="autoScroll.enabled.value"
          :highlight="highlight"
        />
        <MessageEmptyState
          v-if="emptyKind"
          :connection-id="connectionId"
          :kind="emptyKind"
          :total="total"
        />
      </ResizablePanel>
      <template v-if="selectedId !== null">
        <ResizableHandle aria-label="Resize message details" />
        <ResizablePanel
          id="messages-detail"
          :order="2"
          :default-size="detailDefault"
          :min-size="detailMin"
          :max-size="70"
          class="min-w-0"
        >
          <MessageDetail
            :connection-id="connectionId"
            :message-id="selectedId"
            @close="closeDetail"
          />
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>
  </section>
</template>
