<script setup lang="ts">
/**
 * Live time-series line chart (uPlot). Series may have different timestamps; they are merged
 * onto one x axis. Data updates use `setData` (at most one per animation frame); the instance
 * is only rebuilt when the series structure (names / colors / y label) or the theme changes.
 *
 * Interaction: crosshair + legend readout (values at the cursor, latest values otherwise),
 * drag to zoom (double-click or "Reset zoom" restores), legend items toggle series, and
 * keyboard inspection (focus the plot, then ← → Home End, Esc).
 */
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type HTMLAttributes
} from 'vue'
import type uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { ChartLineIcon, ZoomOutIcon } from '@lucide/vue'
import { useMutationObserver, useResizeObserver } from '@vueuse/core'
import type { ChartSeries } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { alignSeries, summarizeSeries } from './lib/chart/align'
import { TimeSeriesPlot, type ChartFrame } from './lib/chart/controller'
import { announceLegend, buildLegend, describeChart } from './lib/chart/readout'
import './lib/chart/chart.css'

const props = withDefaults(
  defineProps<{
    /** Points are `[epochMs, value]`, ascending. Pass new arrays to update (not deep-watched). */
    series: readonly ChartSeries[]
    /** Total height in px, legend row included. */
    height?: number
    yLabel?: string
    emptyText?: string
    class?: HTMLAttributes['class']
  }>(),
  { height: 220, emptyText: 'No data yet' }
)

const LEGEND_HEIGHT = 24
const MIN_WIDTH = 16

const box = ref<HTMLElement | null>(null)
const mount = ref<HTMLElement | null>(null)
const aligned = shallowRef<uPlot.AlignedData | null>(null)
const cursorIdx = ref<number | null>(null)
const cursorIdxs = shallowRef<ReadonlyArray<number | null>>([])
const hidden = shallowRef<ReadonlySet<string>>(new Set())
const zoomed = ref(false)
const keyboard = ref(false)
const announcement = ref('')

const plot = new TimeSeriesPlot({
  cursor: (idx, idxs) => {
    cursorIdx.value = idx
    cursorIdxs.value = idxs
  },
  zoom: (value) => {
    zoomed.value = value
  }
})

let width = 0
let frameRequest = 0
let themeTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false

const plotHeight = computed(() => Math.max(80, props.height - LEGEND_HEIGHT))
const summaries = computed(() => summarizeSeries(props.series))
const isEmpty = computed(() => summaries.value.every((s) => s.count === 0))
const multi = computed(() => props.series.length > 1)

const legend = computed(() =>
  buildLegend({
    series: props.series,
    summaries: summaries.value,
    data: aligned.value,
    cursorIdx: cursorIdx.value,
    cursorIdxs: cursorIdxs.value,
    hidden: hidden.value
  })
)
const description = computed(() => describeChart(summaries.value, props.emptyText))

function currentFrame(): ChartFrame | null {
  const host = mount.value
  const themeRoot = box.value
  const data = aligned.value
  if (!host || !themeRoot || !data) return null
  return {
    host,
    themeRoot,
    series: props.series,
    data,
    width,
    height: plotHeight.value,
    hidden: hidden.value,
    yLabel: props.yLabel
  }
}

function render(): void {
  if (disposed) return
  if (isEmpty.value) {
    plot.destroy()
    aligned.value = null
    return
  }
  aligned.value = alignSeries(props.series)
  if (width < MIN_WIDTH) return // not laid out yet (e.g. hidden tab); the resize observer retries
  const frame = currentFrame()
  if (frame) plot.render(frame)
}

function scheduleRender(): void {
  if (frameRequest || disposed) return
  frameRequest = requestAnimationFrame(() => {
    frameRequest = 0
    render()
  })
}

function refreshTheme(): void {
  const frame = currentFrame()
  if (frame && !disposed) plot.refreshTheme(frame)
}

function resetZoom(): void {
  if (aligned.value) plot.resetZoom(aligned.value)
}

function toggle(index: number): void {
  const name = props.series[index]?.name
  if (name === undefined) return
  const next = new Set(hidden.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  hidden.value = next
  plot.setVisible(index, !next.has(name))
}

function onKeydown(event: KeyboardEvent): void {
  const xs = aligned.value?.[0]
  if (!xs || xs.length === 0) return
  if (event.key === 'Escape') {
    keyboard.value = false
    plot.hideCursor()
    return
  }
  const [lo, hi] = plot.visibleRange(xs.length)
  const current = Math.min(hi, Math.max(lo, cursorIdx.value ?? hi))
  const moves: Readonly<Record<string, number>> = {
    ArrowLeft: Math.max(lo, current - 1),
    ArrowRight: Math.min(hi, current + 1),
    Home: lo,
    End: hi
  }
  const next = moves[event.key]
  if (next === undefined) return
  event.preventDefault()
  keyboard.value = true
  plot.showCursorAt(xs[next])
}

function onBlur(): void {
  if (!keyboard.value) return
  keyboard.value = false
  plot.hideCursor()
}

// Screen readers hear the readout only while inspecting with the keyboard.
watch(legend, (value) => {
  if (keyboard.value && value.live) announcement.value = announceLegend(value, multi.value)
})

watch(
  [() => props.series, () => props.series.map((s) => s.points.length).join(), () => props.yLabel],
  scheduleRender
)
watch(plotHeight, (height) => plot.resize(width, height))

useResizeObserver(box, (entries) => {
  const next = Math.floor(entries[0]?.contentRect.width ?? 0)
  if (next === width) return
  width = next
  if (width < MIN_WIDTH) return
  if (plot.active) plot.resize(width, plotHeight.value)
  else scheduleRender()
})

useMutationObserver(
  document.documentElement,
  () => {
    refreshTheme()
    clearTimeout(themeTimer)
    // Check again once color transitions on ancestors have settled.
    themeTimer = setTimeout(refreshTheme, 260)
  },
  { attributes: true, attributeFilter: ['class', 'data-accent'] }
)

onMounted(() => {
  scheduleRender()
  void document.fonts.ready.then(() => {
    if (!disposed) plot.redrawAxes()
  })
})

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(frameRequest)
  clearTimeout(themeTimer)
  plot.destroy()
})
</script>

<template>
  <div data-slot="time-series-chart" :class="cn('mq-chart flex min-w-0 flex-col', props.class)">
    <div class="flex h-6 shrink-0 items-center gap-x-3 overflow-hidden px-0.5 text-xs">
      <span
        v-if="legend.time"
        :class="
          cn(
            'shrink-0 font-mono tabular-nums transition-colors',
            legend.live ? 'text-foreground' : 'text-muted-foreground'
          )
        "
      >
        {{ legend.time }}
      </span>
      <template v-if="multi">
        <button
          v-for="(item, index) in legend.items"
          :key="item.name"
          type="button"
          :aria-pressed="!item.off"
          :title="item.off ? `Show ${item.name}` : `Hide ${item.name}`"
          :class="
            cn(
              'inline-flex min-w-0 items-center gap-1.5 rounded-sm outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/50',
              item.off && 'opacity-40'
            )
          "
          @click="toggle(index)"
        >
          <span
            class="h-0.5 w-3 shrink-0 rounded-full"
            :style="{ backgroundColor: item.color }"
            aria-hidden="true"
          />
          <span class="truncate text-muted-foreground">{{ item.name }}</span>
          <span class="font-mono font-medium text-foreground tabular-nums">{{ item.value }}</span>
        </button>
      </template>
      <span
        v-else-if="legend.items[0] && !isEmpty"
        class="font-mono font-medium text-foreground tabular-nums"
      >
        {{ legend.items[0].value }}
      </span>
      <Button
        v-if="zoomed"
        variant="ghost"
        size="xs"
        class="ml-auto h-5 shrink-0 px-1.5 text-muted-foreground"
        @click="resetZoom"
      >
        <ZoomOutIcon aria-hidden="true" />
        Reset zoom
      </Button>
    </div>
    <div
      ref="box"
      role="img"
      :aria-label="description"
      :tabindex="isEmpty ? undefined : 0"
      class="relative min-w-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      :style="{ height: `${plotHeight}px` }"
      @keydown="onKeydown"
      @blur="onBlur"
      @pointermove="keyboard = false"
    >
      <div ref="mount" class="absolute inset-0" />
      <div
        v-if="isEmpty"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground"
      >
        <ChartLineIcon class="size-4 opacity-60" aria-hidden="true" />
        <span>{{ emptyText }}</span>
      </div>
    </div>
    <span class="sr-only" aria-live="polite">{{ announcement }}</span>
  </div>
</template>
