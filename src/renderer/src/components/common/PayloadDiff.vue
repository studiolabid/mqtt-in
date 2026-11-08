<script setup lang="ts">
/**
 * Line diff of a message against the previous one on the same topic (both decoded with the view
 * format, pretty printed): additions and removals tinted, line numbers, and long unchanged
 * stretches folded into expandable markers.
 *
 * Slot `time` ({ timestamp }) renders the previous message's time (default: a clock time).
 */
import { computed, ref, watch, type HTMLAttributes } from 'vue'
import { ChevronsUpDownIcon } from '@lucide/vue'
import type { MqttMessage, ViewFormat } from '@shared/models'
import { decodePayload } from '@shared/payload'
import { cn } from '@/lib/utils'
import {
  diffLineNumbers,
  diffSummary,
  foldDiff,
  lineDiff,
  type DiffLine,
  type DiffLineKind
} from '@/utils/diff'
import { formatClock } from '@/utils/format'

/** Payloads are compared on their first 256 KB. */
const MAX_DIFF_BYTES = 256 * 1024
/** Lines rendered at most (the diff itself is complete). */
const MAX_RENDERED_LINES = 3000

const props = defineProps<{
  current: MqttMessage
  /** The message before `current`; `undefined` for the oldest one. */
  previous?: MqttMessage
  format: ViewFormat
  wrap: boolean
  class?: HTMLAttributes['class']
  /** Classes of the scrolling diff body (e.g. a max height). */
  bodyClass?: HTMLAttributes['class']
}>()

function decode(message: MqttMessage): { text: string; truncated: boolean } {
  return decodePayload(message.payload, props.format, { pretty: true, maxBytes: MAX_DIFF_BYTES })
}

const diff = computed(() => {
  if (!props.previous) return { lines: [] as DiffLine[], cut: false }
  const before = decode(props.previous)
  const after = decode(props.current)
  return { lines: lineDiff(before.text, after.text), cut: before.truncated || after.truncated }
})
const summary = computed(() => diffSummary(diff.value.lines))
const numbers = computed(() => diffLineNumbers(diff.value.lines))
const blocks = computed(() => foldDiff(diff.value.lines))
const opened = ref<ReadonlySet<number>>(new Set())
watch(diff, () => {
  opened.value = new Set()
})

/** Blocks to render, cut once `MAX_RENDERED_LINES` lines are shown. */
const rendered = computed(() => {
  let budget = MAX_RENDERED_LINES
  const out: Array<{ key: number; folded: boolean; lines: readonly DiffLine[] }> = []
  for (const block of blocks.value) {
    if (budget <= 0) break
    const folded = block.kind === 'fold' && !opened.value.has(block.key)
    const shown = folded ? block.lines : block.lines.slice(0, budget)
    out.push({ key: block.key, folded, lines: shown })
    if (!folded) budget -= shown.length
  }
  return out
})
const hiddenLines = computed(() => {
  const shown = rendered.value.reduce((n, block) => n + block.lines.length, 0)
  return Math.max(0, diff.value.lines.length - shown)
})
const identical = computed(() => summary.value.added + summary.value.removed === 0)

function unfold(key: number): void {
  const next = new Set(opened.value)
  next.add(key)
  opened.value = next
}

const LINE_CLASS: Readonly<Record<DiffLineKind, string>> = {
  added: 'bg-success/10',
  removed: 'bg-destructive/10',
  unchanged: ''
}
const SIGN_CLASS: Readonly<Record<DiffLineKind, string>> = {
  added: 'text-success',
  removed: 'text-destructive',
  unchanged: 'text-muted-foreground/40'
}
const SIGN: Readonly<Record<DiffLineKind, string>> = { added: '+', removed: '−', unchanged: ' ' }
</script>

<template>
  <div
    data-slot="payload-diff"
    :class="
      cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border border-input dark:bg-input/30',
        props.class
      )
    "
  >
    <div
      class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <template v-if="previous">
        <span class="font-mono font-medium tabular-nums">
          <span class="text-success">+{{ summary.added }}</span>
          <span class="ml-1.5 text-destructive">−{{ summary.removed }}</span>
        </span>
        <span class="inline-flex min-w-0 items-center gap-1">
          vs previous message from
          <slot name="time" :timestamp="previous.timestamp">
            <span class="font-mono text-foreground tabular-nums">{{
              formatClock(previous.timestamp)
            }}</span>
          </slot>
        </span>
      </template>
      <span v-else>The oldest message in the history: there is nothing to compare it with.</span>
    </div>

    <p v-if="previous && identical" class="px-3 py-2.5 text-xs text-muted-foreground italic">
      Identical to the previous message.
    </p>

    <div
      v-else-if="previous"
      :class="
        cn('overflow-auto py-1.5 font-mono text-xs leading-5 select-text scrollbar-slim', bodyClass)
      "
    >
      <template v-for="block in rendered" :key="block.key">
        <button
          v-if="block.folded"
          type="button"
          class="flex w-full items-center gap-2 bg-muted/40 px-3 py-0.5 text-left font-sans text-xs text-muted-foreground transition-colors select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
          @click="unfold(block.key)"
        >
          <ChevronsUpDownIcon class="size-3.5" aria-hidden="true" />
          {{ block.lines.length }} unchanged lines
        </button>
        <template v-else>
          <div
            v-for="(line, index) in block.lines"
            :key="index"
            :class="cn('flex min-w-max pr-3', wrap && 'min-w-0', LINE_CLASS[line.kind])"
          >
            <span
              class="w-9 shrink-0 pr-1 text-right text-muted-foreground/60 tabular-nums select-none"
              aria-hidden="true"
              >{{ numbers[block.key + index] }}</span
            >
            <span
              :class="cn('w-5 shrink-0 text-center select-none', SIGN_CLASS[line.kind])"
              aria-hidden="true"
              >{{ SIGN[line.kind] }}</span
            >
            <span class="sr-only">{{ line.kind === 'unchanged' ? '' : `${line.kind}: ` }}</span>
            <span
              :class="
                cn(
                  'min-w-0',
                  wrap ? 'wrap-anywhere whitespace-pre-wrap' : 'whitespace-pre',
                  line.kind === 'unchanged' && 'text-foreground/75'
                )
              "
              >{{ line.text || ' ' }}</span
            >
          </div>
        </template>
      </template>
    </div>

    <p
      v-if="previous && (hiddenLines > 0 || diff.cut)"
      class="border-t px-3 py-1.5 text-[11px] text-muted-foreground"
    >
      {{
        hiddenLines > 0
          ? `${hiddenLines} more lines not shown.`
          : 'Compared on the first 256 KB of each payload.'
      }}
    </p>
  </div>
</template>
