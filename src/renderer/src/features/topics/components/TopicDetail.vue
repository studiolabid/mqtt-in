<script setup lang="ts">
/**
 * Detail of the selected topic: header with actions, then Value / History / Chart tabs (and
 * Subtopics for nodes that also have children). Branches without messages of their own show
 * a summary of their subtree instead. Data is a throttled snapshot, frozen while paused.
 *
 * While something is pinned, the Pinned strip sits on top (FP-3); "Chart pinned" swaps the
 * topic detail for one chart of every pinned value, and a tile opens its topic again.
 * The tab shown follows the stored preference, except that a Chart preference shows Value for
 * a topic without numbers (UX-18, `resolveDetailTab`).
 */
import { computed, ref } from 'vue'
import {
  BellPlusIcon,
  BracesIcon,
  ChartSplineIcon,
  HistoryIcon,
  ListTreeIcon,
  MousePointerClickIcon,
  RadioTowerIcon,
  SendHorizontalIcon
} from '@lucide/vue'
import { EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePinsStore } from '@/stores/pins'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { resolveDetailTab, topicExplorerState, type DetailTab } from '../composables/explorer-state'
import { usePinnedSeries } from '../composables/usePinnedSeries'
import { useTopicActions } from '../composables/useTopicActions'
import { useTopicSnapshot } from '../composables/useTopicData'
import { numbersOf } from '../utils/chart-data'
import MessageViewer from './MessageViewer.vue'
import PinnedChart from './PinnedChart.vue'
import PinnedStrip from './PinnedStrip.vue'
import TopicBranchSummary from './TopicBranchSummary.vue'
import TopicChart from './TopicChart.vue'
import TopicDetailHeader from './TopicDetailHeader.vue'
import TopicHistory from './TopicHistory.vue'

const props = defineProps<{
  connectionId: string
  /** Selected topic (`null` = nothing selected). */
  topic: string | null
}>()

const TABS: readonly DetailTab[] = ['value', 'history', 'chart', 'subtopics']

const ui = useUiStore()
const settings = useSettingsStore()
const pinsStore = usePinsStore()
const state = computed(() => topicExplorerState(props.connectionId))
const actions = useTopicActions(() => props.connectionId)
const node = useTopicSnapshot(
  () => props.connectionId,
  () => props.topic
)
/** The topic on which the user last picked a tab here. */
const pickedFor = ref<string | null>(null)

const pinned = usePinnedSeries({
  connectionId: () => props.connectionId,
  window: () => state.value.pinnedWindow.value,
  dark: () => settings.isDark,
  chart: () => state.value.pinnedChart.value
})
const chartPinned = computed({
  get: () => state.value.pinnedChart.value && pinned.tiles.value.length > 0,
  set: (value: boolean) => {
    state.value.pinnedChart.value = value
  }
})
const pinnedWindow = computed({
  get: () => state.value.pinnedWindow.value,
  set: (value) => {
    state.value.pinnedWindow.value = value
  }
})

const hasValue = computed(() => (node.value?.messageCount ?? 0) > 0)
const hasChildren = computed(() => (node.value?.childCount ?? 0) > 0)
const numeric = computed(() => {
  const last = node.value?.lastMessage
  return last !== undefined && numbersOf(last) !== null
})
const tab = computed<DetailTab>(() =>
  resolveDetailTab(state.value.detailTab.value, {
    topic: props.topic ?? '',
    hasChildren: hasChildren.value,
    numeric: numeric.value,
    pickedFor: pickedFor.value
  })
)

function onTab(value: string | number): void {
  const next = TABS.find((entry) => entry === value)
  if (!next) return
  state.value.detailTab.value = next
  pickedFor.value = props.topic
}

function openPinned(topic: string): void {
  chartPinned.value = false
  ui.selectTopic(props.connectionId, topic)
}
</script>

<template>
  <section
    data-testid="topic-detail"
    aria-label="Topic detail"
    class="@container/detail flex h-full min-h-0 min-w-0 flex-col"
  >
    <PinnedStrip
      v-if="pinned.tiles.value.length > 0"
      v-model:chart="chartPinned"
      :tiles="pinned.tiles.value"
      @select="openPinned"
      @unpin="(pinId: string) => pinsStore.unpin(connectionId, pinId)"
    />

    <PinnedChart
      v-if="chartPinned"
      v-model:window="pinnedWindow"
      :series="pinned.chartSeries.value"
      :note="pinned.chartNote.value"
    />

    <EmptyState
      v-else-if="topic === null"
      :icon="MousePointerClickIcon"
      title="Select a topic"
      description="Inspect its latest value, browse its history with diffs and chart numeric fields."
      class="min-h-0 flex-1"
    >
      <p
        class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        <span class="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span class="inline-flex items-center gap-1"><Kbd>→</Kbd> expand</span>
        <span class="inline-flex items-center gap-1"><Kbd>←</Kbd> collapse</span>
      </p>
    </EmptyState>

    <template v-else>
      <TopicDetailHeader :connection-id="connectionId" :topic="topic" :node="node" />

      <EmptyState
        v-if="!node"
        compact
        :icon="RadioTowerIcon"
        title="Nothing received on this topic"
        description="It is not part of the live topic tree yet. Subscribe to it or publish a first message."
        class="min-h-0 flex-1"
      >
        <Button size="sm" variant="outline" @click="actions.subscribe(topic, false)">
          <BellPlusIcon aria-hidden="true" />
          Subscribe…
        </Button>
        <Button size="sm" variant="outline" @click="actions.publishTo(topic)">
          <SendHorizontalIcon aria-hidden="true" />
          Publish
        </Button>
      </EmptyState>

      <Tabs
        v-else-if="hasValue"
        :model-value="tab"
        class="min-h-0 flex-1 flex-col gap-0"
        @update:model-value="onTab"
      >
        <div class="flex h-10 shrink-0 items-center border-b px-3">
          <TabsList
            class="max-w-full overflow-x-auto overflow-y-hidden scrollbar-none group-data-horizontal/tabs:h-7"
          >
            <TabsTrigger value="value" data-testid="topic-tab-value" class="px-2 text-xs">
              <BracesIcon class="size-3.5" aria-hidden="true" />
              Value
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="topic-tab-history" class="px-2 text-xs">
              <HistoryIcon class="size-3.5" aria-hidden="true" />
              History
            </TabsTrigger>
            <TabsTrigger value="chart" data-testid="topic-tab-chart" class="px-2 text-xs">
              <ChartSplineIcon class="size-3.5" aria-hidden="true" />
              Chart
            </TabsTrigger>
            <TabsTrigger v-if="hasChildren" value="subtopics" class="px-2 text-xs">
              <ListTreeIcon class="size-3.5" aria-hidden="true" />
              Subtopics
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="value" class="flex min-h-0 flex-col">
          <MessageViewer
            v-if="node.lastMessage"
            :connection-id="connectionId"
            :message="node.lastMessage"
            :full-bytes="node.lastPayloadBytes"
            class="min-h-0 flex-1"
          />
        </TabsContent>
        <TabsContent value="history" class="flex min-h-0 flex-col">
          <TopicHistory :connection-id="connectionId" :topic="topic" class="min-h-0 flex-1" />
        </TabsContent>
        <TabsContent value="chart" class="flex min-h-0 flex-col">
          <TopicChart
            :connection-id="connectionId"
            :topic="topic"
            :received="node.messageCount"
            class="min-h-0 flex-1"
          />
        </TabsContent>
        <TabsContent v-if="hasChildren" value="subtopics" class="flex min-h-0 flex-col">
          <TopicBranchSummary :connection-id="connectionId" :node="node" class="min-h-0 flex-1" />
        </TabsContent>
      </Tabs>

      <TopicBranchSummary
        v-else
        :connection-id="connectionId"
        :node="node"
        class="min-h-0 flex-1"
      />
    </template>
  </section>
</template>
