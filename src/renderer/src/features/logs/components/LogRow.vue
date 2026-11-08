<script setup lang="ts">
/**
 * One log entry: disclosure chevron (entries with a detail), time, level badge, message
 * (wraps, selectable, search matches highlighted), the expanded detail and a copy button.
 *
 * An option of the log listbox (`logRowAria`): its id is the list's active descendant, and it
 * reports selection (the cursor), expansion and its position. The copy button stays out of the
 * Tab order (C / Ctrl+C copy the entry under the cursor); it shows on hover and on the cursor row.
 */
import { computed } from 'vue'
import { ChevronRightIcon } from '@lucide/vue'
import type { LogEntry } from '@shared/models'
import { CopyButton } from '@/components/common'
import { cn } from '@/lib/utils'
import LogDetail from './LogDetail.vue'
import { LEVEL_TONES } from '../utils/levels'
import { logEntryToText } from '../utils/log-text'
import { logRowAria } from '../utils/row-aria'
import { containsTerm, highlightParts } from '@/utils/highlight'

const props = defineProps<{
  entry: LogEntry
  /** Display time (settings aware). */
  time: string
  /** Full timestamp for the tooltip. */
  stamp: string
  expanded: boolean
  /** Keyboard cursor. */
  active: boolean
  search: string
  /** Position in the filtered list (0-based) and its length. */
  index: number
  total: number
}>()

/** Emits the entry itself so the list can pass one stable handler to every row. */
const emit = defineEmits<{ activate: [entry: LogEntry, event: MouseEvent] }>()

const parts = computed(() => highlightParts(props.entry.message, props.search))
const aria = computed(() =>
  logRowAria(props.entry, {
    active: props.active,
    expanded: props.expanded,
    index: props.index,
    total: props.total
  })
)

/** The search only matches the (collapsed) detail: hint at it on the chevron. */
const detailMatches = computed(
  () =>
    !props.expanded &&
    props.entry.detail !== undefined &&
    containsTerm(props.entry.detail, props.search) &&
    !containsTerm(props.entry.message, props.search)
)
</script>

<template>
  <div
    v-bind="aria"
    data-testid="log-row"
    :data-level="entry.level"
    :data-active="active || undefined"
    :class="
      cn(
        'group/row relative flex items-start gap-2 py-[3px] pr-1.5 pl-1.5 text-[13px] leading-5 transition-colors duration-100 hover:bg-muted/60',
        LEVEL_TONES[entry.level].row,
        active &&
          'bg-muted/70 group-focus/list:bg-accent group-focus/list:shadow-[inset_2px_0_0_var(--primary)]'
      )
    "
    @click="emit('activate', entry, $event)"
  >
    <span class="flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground">
      <ChevronRightIcon
        v-if="entry.detail"
        :class="
          cn(
            'size-3.5 transition-transform duration-150',
            expanded && 'rotate-90 text-foreground',
            detailMatches && 'text-primary-text'
          )
        "
        aria-hidden="true"
      />
    </span>
    <span
      class="shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums"
      :title="stamp"
    >
      {{ time }}
    </span>
    <span
      :class="
        cn(
          'mt-0.5 inline-flex h-4 w-[2.625rem] shrink-0 items-center justify-center rounded-[4px] font-mono text-[9.5px] font-semibold tracking-wider uppercase',
          LEVEL_TONES[entry.level].badge
        )
      "
    >
      {{ entry.level }}
    </span>
    <div class="min-w-0 flex-1">
      <p
        :class="
          cn(
            'whitespace-pre-wrap select-text wrap-break-word',
            entry.level === 'debug' && 'text-muted-foreground'
          )
        "
      >
        <template v-for="(part, partIndex) in parts" :key="partIndex">
          <mark v-if="part.match" class="search-match">{{ part.text }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
      <LogDetail
        v-if="expanded && entry.detail"
        :detail="entry.detail"
        :search="search"
        @click.stop
      />
    </div>
    <CopyButton
      :value="() => logEntryToText(entry)"
      label="log entry"
      tabindex="-1"
      :class="
        cn(
          'size-5 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100',
          active && 'opacity-100'
        )
      "
    />
  </div>
</template>

<style scoped>
.search-match {
  border-radius: 2px;
  background-color: color-mix(in oklch, var(--warning) 32%, transparent);
  color: inherit;
}
</style>
