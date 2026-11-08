<script setup lang="ts">
/**
 * Chart tab: numeric fields of the topic's recent history as live time series. Pick fields
 * (chips, each with a pin to the Pinned strip), a time window, and one shared chart or one
 * chart per field (never two y-axes on one plot); a values table sits underneath.
 *
 * The history is what the buffer still holds, at most `HISTORY_LIMIT` messages: when older
 * messages were dropped and the window reaches further back, the chart says how much it shows
 * ("Showing the last 4.8 s — …"), the windows carry the covered span ('15m (4.8 s)') and the
 * table's caption names the span its statistics cover (PERF-05).
 */
import { computed, ref } from 'vue'
import { ChartLineIcon, HistoryIcon, InfoIcon, LayersIcon, Rows3Icon } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { EmptyState, TimeSeriesChart } from '@/components/common'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSettingsStore } from '@/stores/settings'
import { topicExplorerState } from '../composables/explorer-state'
import { chipPinField, usePinToggle } from '../composables/usePinnedSeries'
import { useTopicChart } from '../composables/useTopicChart'
import { HISTORY_LIMIT, useTopicHistory } from '../composables/useTopicData'
import { CHART_WINDOWS, chartWindow, isChartWindowId } from '../utils/chart-data'
import { coverageNote, formatSpan, windowLabel } from '../utils/coverage'
import ChartFieldChips from './ChartFieldChips.vue'
import ChartStatsTable from './ChartStatsTable.vue'

const MIN_CHART_HEIGHT = 160
const MAX_CHART_HEIGHT = 640
const SPLIT_MIN_HEIGHT = 120
const SPLIT_MAX_HEIGHT = 240
/** Caption row above each chart of the split layout + the gap between charts. */
const SPLIT_CHROME = 20 + 12
/** Height of the "ranges differ" hint under the overlay chart. */
const HINT_HEIGHT = 28
/** Values table: header + one row per series (28 px each), border and top margin. */
const TABLE_ROW = 28
const TABLE_CHROME = 2 + 12
/** The coverage note above the chart and the table caption, when the data is partial. */
const NOTE_HEIGHT = 28
const CAPTION_HEIGHT = 24

const props = defineProps<{
  connectionId: string
  topic: string
  /** Messages received on the topic in total (evicted ones included). */
  received: number
}>()

const settings = useSettingsStore()
const state = computed(() => topicExplorerState(props.connectionId))
const history = useTopicHistory(
  () => props.connectionId,
  () => props.topic
)

const windowId = computed(() => state.value.chartWindow.value)
const layout = computed(() => state.value.chartLayout.value)

const { fields, selection, series, rows, scalesDiffer, colorOf, toggle, canSelectMore, coverage } =
  useTopicChart({
    connectionId: () => props.connectionId,
    topic: () => props.topic,
    history,
    window: () => windowId.value,
    dark: () => settings.isDark,
    received: () => props.received,
    pointLimit: HISTORY_LIMIT
  })

const pins = usePinToggle(() => props.connectionId)
const last = computed(() => history.value[history.value.length - 1])
const note = computed(() =>
  coverageNote(coverage.value, {
    buffer: settings.settings.maxMessagesPerConnection,
    points: HISTORY_LIMIT
  })
)
const statsCaption = computed(() =>
  coverage.value.partial ? `Values of the last ${formatSpan(coverage.value.coverageMs)}` : null
)
/** The windows with the span the data covers where it is shorter (`15m (4.8 s)`). */
const windows = computed(() =>
  CHART_WINDOWS.map((entry) => {
    const text = windowLabel(entry.label, entry.ms, coverage.value)
    const span = formatSpan(coverage.value.coverageMs)
    return {
      ...entry,
      text,
      describe: text === entry.label ? entry.title : `${entry.title}, the data covers ${span}`
    }
  })
)

function fieldPinned(field: string): boolean {
  return pins.isPinned(props.topic, chipPinField(field, last.value))
}

function togglePin(field: string): void {
  pins.toggle(props.topic, chipPinField(field, last.value))
}

const area = ref<HTMLElement | null>(null)
const { height } = useElementSize(area)

const split = computed(() => layout.value === 'split' && series.value.length > 1)
const showHint = computed(() => !split.value && series.value.length > 1 && scalesDiffer.value)
const splitSeries = computed(() => series.value.map((entry) => [entry]))

/** Height left for the chart(s) once the values table below them is visible. */
const chartSpace = computed(() => {
  const table = rows.value.length > 0 ? (rows.value.length + 1) * TABLE_ROW + TABLE_CHROME : 0
  const extra = (note.value ? NOTE_HEIGHT : 0) + (statsCaption.value ? CAPTION_HEIGHT : 0)
  return Math.floor(height.value) - table - extra
})
const overlayHeight = computed(() => {
  const available = chartSpace.value - (showHint.value ? HINT_HEIGHT : 0)
  return Math.min(MAX_CHART_HEIGHT, Math.max(MIN_CHART_HEIGHT, available))
})
const splitHeight = computed(() => {
  const count = Math.max(1, series.value.length)
  const each = Math.floor(chartSpace.value / count) - SPLIT_CHROME
  return Math.min(SPLIT_MAX_HEIGHT, Math.max(SPLIT_MIN_HEIGHT, each))
})
const emptyText = computed(() => `No values ${chartWindow(windowId.value).phrase}`)

function onWindow(value: unknown): void {
  if (isChartWindowId(value)) state.value.chartWindow.value = value
}

function onLayout(value: unknown): void {
  if (value === 'overlay' || value === 'split') state.value.chartLayout.value = value
}
</script>

<template>
  <EmptyState
    v-if="history.length === 0"
    compact
    :icon="HistoryIcon"
    title="No messages in the buffer"
    description="Charts are drawn from the messages still in the buffer. New ones show up as they arrive."
    class="h-full"
  />
  <EmptyState
    v-else-if="fields.length === 0"
    compact
    :icon="ChartLineIcon"
    title="Payloads on this topic are not numeric"
    description="Charts plot plain numbers, true / false and numeric JSON fields up to 5 levels deep."
    class="h-full"
  />
  <div v-else data-testid="topic-chart" class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-2 border-b px-3 py-2">
      <ChartFieldChips
        class="min-w-0 flex-1 basis-48"
        :fields="fields"
        :selection="selection"
        :color-of="colorOf"
        :can-select-more="canSelectMore"
        :is-pinned="fieldPinned"
        @toggle="toggle"
        @pin="togglePin"
      />
      <div class="flex shrink-0 items-center gap-1.5">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          :model-value="windowId"
          aria-label="Time window"
          @update:model-value="onWindow"
        >
          <ToggleGroupItem
            v-for="entry in windows"
            :key="entry.id"
            :value="entry.id"
            :aria-label="entry.describe"
            :title="entry.describe"
            class="h-6 min-w-0 px-2 font-mono text-[11px]"
          >
            {{ entry.text }}
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          v-if="series.length > 1"
          type="single"
          variant="outline"
          size="sm"
          :model-value="layout"
          aria-label="Chart layout"
          @update:model-value="onLayout"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <ToggleGroupItem value="overlay" aria-label="One chart" class="h-6 min-w-0 px-1.5">
                <LayersIcon aria-hidden="true" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>One chart, shared scale</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <ToggleGroupItem
                value="split"
                aria-label="One chart per field"
                class="h-6 min-w-0 px-1.5"
              >
                <Rows3Icon aria-hidden="true" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>One chart per field, own scales</TooltipContent>
          </Tooltip>
        </ToggleGroup>
      </div>
    </div>

    <div ref="area" class="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3 scrollbar-slim">
      <p
        v-if="note"
        data-testid="topic-chart-coverage"
        class="flex min-h-7 items-center gap-1.5 text-xs text-muted-foreground"
      >
        <InfoIcon class="size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span class="min-w-0">{{ note }}</span>
      </p>
      <div
        v-if="selection.size === 0"
        class="flex h-full items-center justify-center text-xs text-muted-foreground"
      >
        Pick a field above to chart it.
      </div>
      <div v-else-if="split" class="flex flex-col gap-3">
        <figure v-for="entry in splitSeries" :key="entry[0].name" class="min-w-0">
          <figcaption class="flex h-5 items-center gap-2 text-xs">
            <span
              class="h-0.5 w-3 shrink-0 rounded-full"
              :style="{ backgroundColor: entry[0].color }"
              aria-hidden="true"
            />
            <span class="truncate font-mono text-muted-foreground">{{ entry[0].name }}</span>
          </figcaption>
          <TimeSeriesChart :series="entry" :height="splitHeight" :empty-text="emptyText" />
        </figure>
      </div>
      <template v-else>
        <TimeSeriesChart :series="series" :height="overlayHeight" :empty-text="emptyText" />
        <p v-if="showHint" class="flex h-7 items-center gap-1 text-xs text-muted-foreground">
          These fields have very different ranges.
          <Button
            variant="link"
            size="xs"
            class="h-auto px-0"
            @click="state.chartLayout.value = 'split'"
          >
            Chart them separately
          </Button>
        </p>
      </template>

      <ChartStatsTable v-if="rows.length > 0" :rows="rows" :caption="statsCaption" class="mt-3" />
    </div>
  </div>
</template>
