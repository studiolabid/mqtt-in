<script setup lang="ts">
/**
 * "Pinned" strip at the top of the topic detail (FP-3), shown only while something is pinned:
 * one tile per pinned value — topic tail · field, the latest value, the change since the
 * previous value and a sparkline in the pin's chart color (no other color in the chrome).
 * A tile opens its topic; × unpins. "Chart pinned" shows every pinned series in one chart in
 * place of the topic detail.
 */
import { ChartSplineIcon, XIcon } from '@lucide/vue'
import { Sparkline } from '@/components/common'
import { formatMeasure } from '@/components/common/lib/chart/format'
import { Toggle } from '@/components/ui/toggle'
import type { PinnedTile } from '../composables/usePinnedSeries'

defineProps<{ tiles: readonly PinnedTile[] }>()

/** The pinned chart replaces the topic detail. */
const chart = defineModel<boolean>('chart', { required: true })

const emit = defineEmits<{
  /** A tile was clicked: show its topic. */
  select: [topic: string]
  unpin: [pinId: string]
}>()

function deltaText(delta: number): string {
  return formatMeasure(Math.abs(delta))
}
</script>

<template>
  <section
    data-testid="pinned-strip"
    aria-label="Pinned values"
    class="flex shrink-0 items-stretch gap-2 overflow-x-auto border-b px-3 py-2 scrollbar-slim"
  >
    <Toggle
      v-model="chart"
      data-testid="pinned-chart-toggle"
      variant="outline"
      size="sm"
      aria-label="Chart pinned"
      class="h-auto min-h-11 shrink-0 flex-col gap-0.5 px-2 text-[11px] text-muted-foreground aria-pressed:text-foreground"
    >
      <ChartSplineIcon aria-hidden="true" />
      Chart pinned
    </Toggle>
    <ul class="flex min-w-0 items-stretch gap-2">
      <li
        v-for="tile in tiles"
        :key="tile.pin.id"
        data-testid="pinned-tile"
        :data-topic="tile.pin.topic"
        :data-field="tile.pin.field"
        class="group/tile relative w-40 shrink-0"
      >
        <button
          type="button"
          :title="tile.title"
          class="flex h-full w-full min-w-0 flex-col gap-1 rounded-lg border bg-card px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-muted/40"
          @click="emit('select', tile.pin.topic)"
        >
          <span class="flex min-w-0 items-center gap-1.5 pr-4">
            <span
              class="h-0.5 w-3 shrink-0 rounded-full"
              :style="{ backgroundColor: tile.color }"
              aria-hidden="true"
            />
            <span class="truncate font-mono text-[11px] text-muted-foreground">{{
              tile.label
            }}</span>
          </span>
          <span class="flex min-w-0 items-end justify-between gap-2">
            <span class="flex min-w-0 items-baseline gap-1.5">
              <span class="truncate font-mono text-sm leading-none font-semibold tabular-nums">
                {{ formatMeasure(tile.value) }}
              </span>
              <span
                v-if="tile.delta !== null"
                class="shrink-0 font-mono text-[11px] leading-none text-muted-foreground tabular-nums"
              >
                <template v-if="tile.delta > 0"
                  ><span aria-hidden="true">▲</span><span class="sr-only">up</span></template
                >
                <template v-else-if="tile.delta < 0"
                  ><span aria-hidden="true">▼</span><span class="sr-only">down</span></template
                >
                <template v-else>±</template>{{ deltaText(tile.delta) }}
              </span>
            </span>
            <Sparkline :values="tile.spark" :color="tile.color" :width="48" :height="16" />
          </span>
        </button>
        <button
          type="button"
          :aria-label="`Unpin ${tile.title}`"
          title="Unpin"
          class="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 outline-none group-hover/tile:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
          @click="emit('unpin', tile.pin.id)"
        >
          <XIcon class="size-3.5" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </section>
</template>
