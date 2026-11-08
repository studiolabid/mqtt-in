<script setup lang="ts">
/**
 * One chart of every pinned value (FP-3), in place of the topic detail: overlaid series in the
 * pins' chart colors, a legend entry per pin, and the topic chart's time windows. The series
 * come from the pin rings (the newest 2,000 values per pin), so the message buffer's eviction
 * never shortens them; `note` says when a busy pin still covers less than the window.
 */
import { computed, ref } from 'vue'
import { InfoIcon } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { TimeSeriesChart } from '@/components/common'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ChartSeries } from '@/types'
import {
  CHART_WINDOWS,
  chartWindow,
  isChartWindowId,
  type ChartWindowId
} from '../utils/chart-data'

const MIN_HEIGHT = 160
const MAX_HEIGHT = 640
const NOTE_HEIGHT = 28

const props = defineProps<{
  series: readonly ChartSeries[]
  /** Caveat about the covered span (see `pinnedChartNote`), or null. */
  note: string | null
}>()

const windowId = defineModel<ChartWindowId>('window', { required: true })

const area = ref<HTMLElement | null>(null)
const { height } = useElementSize(area)

const chartHeight = computed(() => {
  const available = Math.floor(height.value) - (props.note ? NOTE_HEIGHT : 0)
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, available))
})
const emptyText = computed(() => `No pinned values ${chartWindow(windowId.value).phrase}`)

function onWindow(value: unknown): void {
  if (isChartWindowId(value)) windowId.value = value
}
</script>

<template>
  <section
    data-testid="pinned-chart"
    aria-label="Chart of the pinned values"
    class="flex min-h-0 flex-1 flex-col"
  >
    <div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
      <h3 class="text-xs font-medium">
        Pinned values
        <span class="ml-1 font-mono text-muted-foreground tabular-nums">{{ series.length }}</span>
      </h3>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        :model-value="windowId"
        aria-label="Time window"
        @update:model-value="onWindow"
      >
        <ToggleGroupItem
          v-for="entry in CHART_WINDOWS"
          :key="entry.id"
          :value="entry.id"
          :aria-label="entry.title"
          :title="entry.title"
          class="h-6 min-w-0 px-2 font-mono text-[11px]"
        >
          {{ entry.label }}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div ref="area" class="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3 scrollbar-slim">
      <p v-if="note" class="flex min-h-7 items-center gap-1.5 text-xs text-muted-foreground">
        <InfoIcon class="size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span class="min-w-0">{{ note }}</span>
      </p>
      <TimeSeriesChart :series="series" :height="chartHeight" :empty-text="emptyText" />
    </div>
  </section>
</template>
