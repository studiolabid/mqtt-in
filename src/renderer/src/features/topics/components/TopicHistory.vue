<script setup lang="ts">
/**
 * History tab: the topic's received messages (newest first) above the selected message, which
 * can be diffed against the one before it. Follows the newest message until one is picked.
 */
import { computed, ref, watch } from 'vue'
import { ArrowUpToLineIcon, DiffIcon, HistoryIcon } from '@lucide/vue'
import { EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFormatters } from '@/composables/useFormatters'
import { useUiStore } from '@/stores/ui'
import { topicExplorerState } from '../composables/explorer-state'
import { HISTORY_LIMIT, useTopicHistory } from '../composables/useTopicData'
import HistoryList from './HistoryList.vue'
import MessageViewer from './MessageViewer.vue'

const props = defineProps<{
  connectionId: string
  topic: string
}>()

const ui = useUiStore()
const fmt = useFormatters()
const state = computed(() => topicExplorerState(props.connectionId))
const history = useTopicHistory(
  () => props.connectionId,
  () => props.topic
)

/** Pinned message, `null` = follow the newest. */
const selectedId = ref<number | null>(null)
watch(
  () => props.topic,
  () => {
    selectedId.value = null
  }
)

const pinnedIndex = computed(() => {
  if (selectedId.value === null) return -1
  const list = history.value
  for (let i = list.length - 1; i >= 0; i--) if (list[i].id === selectedId.value) return i
  return -1
})

// A pinned message that left the history (buffer eviction): follow the newest again.
watch(pinnedIndex, (index) => {
  if (index === -1 && selectedId.value !== null) selectedId.value = null
})

const currentIndex = computed(() =>
  pinnedIndex.value >= 0 ? pinnedIndex.value : history.value.length - 1
)
const current = computed(() => history.value[currentIndex.value])
const previous = computed(() =>
  currentIndex.value > 0 ? history.value[currentIndex.value - 1] : undefined
)

const diff = computed({
  get: () => state.value.historyDiff.value,
  set: (value: boolean) => {
    state.value.historyDiff.value = value
  }
})
const format = computed(() => ui.viewFormat(props.connectionId))
const capped = computed(() => history.value.length >= HISTORY_LIMIT)
</script>

<template>
  <EmptyState
    v-if="history.length === 0"
    compact
    :icon="HistoryIcon"
    title="No messages in the buffer"
    description="Earlier messages of this topic left the message buffer. New ones show up here as they arrive."
    class="h-full"
  />
  <div v-else class="flex h-full min-h-0 flex-col">
    <div
      class="flex h-9 shrink-0 items-center gap-2 border-b pr-2 pl-3 text-xs text-muted-foreground"
    >
      <span class="truncate">
        <span class="font-mono text-foreground tabular-nums">{{ fmt.number(history.length) }}</span>
        {{ capped ? 'latest messages' : history.length === 1 ? 'message' : 'messages' }}
      </span>
      <Button
        v-if="selectedId !== null"
        variant="ghost"
        size="xs"
        class="shrink-0"
        @click="selectedId = null"
      >
        <ArrowUpToLineIcon aria-hidden="true" />
        Latest
      </Button>
      <span v-else class="hidden shrink-0 items-center gap-1.5 @sm/detail:inline-flex">
        <span class="size-1.5 rounded-full bg-success" aria-hidden="true" />
        Following latest
      </span>
      <Tooltip>
        <TooltipTrigger as-child>
          <Toggle
            v-model="diff"
            variant="outline"
            size="sm"
            aria-label="Diff with previous message"
            class="ml-auto h-7 shrink-0 gap-1.5 px-2 text-xs data-[state=on]:border-primary/40 data-[state=on]:text-foreground"
          >
            <DiffIcon aria-hidden="true" />
            Diff<span class="hidden @md/detail:inline"> with previous</span>
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Compare the selected message with the one before it</TooltipContent>
      </Tooltip>
    </div>
    <ResizablePanelGroup
      direction="vertical"
      auto-save-id="mqtey:topic-history"
      class="min-h-0 flex-1"
    >
      <ResizablePanel :default-size="40" :min-size="15" class="min-h-0">
        <HistoryList
          :messages="history"
          :selected-id="selectedId"
          :format="format"
          :reset-key="topic"
          @select="(id: number) => (selectedId = id)"
          @follow="selectedId = null"
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel :default-size="60" :min-size="25" class="min-h-0">
        <MessageViewer
          v-if="current"
          :connection-id="connectionId"
          :message="current"
          :previous="previous"
          :diff="diff"
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
</template>
