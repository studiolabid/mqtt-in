<script setup lang="ts">
/**
 * One 28 px row of the virtualized topic tree. Props are plain values, so rows whose data did
 * not change skip re-rendering when the tree refreshes. A row flashes softly when its subtree
 * receives a message while it is on screen (never on mount, off for reduced motion).
 *
 * The row exposes its sibling position (`aria-posinset` / `aria-setsize`, A11Y-13): only a
 * window of the tree is in the DOM. A numeric value can be pinned to the top (FP-3): the pin
 * shows on hover, and always while pinned (outside the Tab order: the detail header has one).
 */
import { computed, ref, watch } from 'vue'
import { BookmarkIcon, ChevronRightIcon, PinIcon } from '@lucide/vue'
import { cn } from '@/lib/utils'
import { formatCompact, formatNumber } from '@/utils/format'
import { highlightParts } from '@/utils/highlight'

/** Indentation per level and left gutter, in px (the guides are drawn on this grid). */
const INDENT = 12
const GUTTER = 6

const props = defineProps<{
  topic: string
  name: string
  depth: number
  /** Offset from the top of the list in px. */
  start: number
  hasChildren: boolean
  expanded: boolean
  selected: boolean
  /** Messages on this topic (leaf) or in the whole subtree (branch). */
  count: number
  /** Topics with messages in the subtree. */
  topics: number
  retained: boolean
  /** One-line preview of the node's own last value (`''` = none). */
  preview: string
  updatedAt: number
  highlight: string
  /** Search results are expanded by the search: chevrons do not toggle. */
  searching: boolean
  /** 1-based position among the siblings shown with the row. */
  posInSet: number
  /** Siblings shown with the row, itself included. */
  setSize: number
  /** The field a pin follows; null when the value is not numeric (no pin offered). */
  pinField: string | null
  pinned: boolean
}>()

const emit = defineEmits<{
  select: []
  toggle: []
  /** Pin or unpin the value (`pinField`). */
  pin: []
}>()

const flash = ref(0)
watch(
  () => props.updatedAt,
  (next, previous) => {
    if (next > previous) flash.value++
  }
)

const nameParts = computed(() => highlightParts(props.name, props.highlight))
const toggles = computed(() => props.hasChildren && !props.searching)
const countTitle = computed(() =>
  props.hasChildren
    ? `${formatNumber(props.count)} messages in ${formatNumber(props.topics)} ${props.topics === 1 ? 'topic' : 'topics'}`
    : `${formatNumber(props.count)} ${props.count === 1 ? 'message' : 'messages'}`
)

function onToggle(): void {
  if (toggles.value) emit('toggle')
}
</script>

<template>
  <div
    role="treeitem"
    data-testid="topic-row"
    :data-topic="topic"
    :aria-level="depth + 1"
    :aria-posinset="posInSet"
    :aria-setsize="setSize"
    :aria-expanded="hasChildren ? expanded : undefined"
    :aria-selected="selected"
    :title="topic || '(empty level)'"
    :class="
      cn(
        'group/row absolute top-0 left-0 flex h-7 w-full cursor-default items-center gap-1.5 pr-2 text-[13px] leading-5',
        selected ? 'bg-primary/10 dark:bg-primary/15' : 'hover:bg-muted/70 dark:hover:bg-muted/50',
        'group-focus-visible/tree:aria-selected:ring-1 group-focus-visible/tree:aria-selected:ring-ring group-focus-visible/tree:aria-selected:ring-inset'
      )
    "
    :style="{ transform: `translateY(${start}px)`, paddingLeft: `${GUTTER + depth * INDENT}px` }"
    @click="emit('select')"
    @dblclick="onToggle"
  >
    <span
      v-if="flash"
      :key="flash"
      class="topic-row-flash pointer-events-none absolute inset-0"
      aria-hidden="true"
    />
    <span
      v-if="depth > 0"
      class="topic-row-guides pointer-events-none absolute inset-y-0"
      :style="{ left: `${GUTTER}px`, width: `${depth * INDENT}px` }"
      aria-hidden="true"
    />
    <span
      v-if="selected"
      class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
      aria-hidden="true"
    />

    <span
      v-if="hasChildren"
      :class="
        cn(
          'relative flex size-4 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground',
          toggles && 'transition-colors hover:bg-foreground/10 hover:text-foreground'
        )
      "
      aria-hidden="true"
      @click.stop="onToggle"
      @dblclick.stop
    >
      <ChevronRightIcon
        :class="cn('size-3.5 transition-transform duration-150', expanded && 'rotate-90')"
      />
    </span>
    <span
      v-else
      class="relative flex size-4 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      <span class="size-1 rounded-full bg-muted-foreground/45" />
    </span>

    <span
      :class="
        cn(
          'relative min-w-0 truncate font-mono',
          hasChildren ? 'font-medium text-foreground' : 'text-foreground/90',
          preview && 'max-w-[65%] shrink-0'
        )
      "
    >
      <span v-if="!name" class="text-muted-foreground italic">(empty)</span>
      <template v-else>
        <template v-for="(part, index) in nameParts" :key="index">
          <mark v-if="part.match" class="rounded-[2px] bg-warning/30 text-inherit">{{
            part.text
          }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </template>
    </span>

    <span v-if="retained" class="relative flex shrink-0 text-muted-foreground">
      <PinIcon class="size-3" aria-hidden="true" />
      <span class="sr-only">retained</span>
    </span>

    <span
      v-if="preview"
      class="relative min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
    >
      <span aria-hidden="true">= </span>{{ preview }}
    </span>

    <button
      v-if="pinField !== null"
      type="button"
      tabindex="-1"
      data-testid="topic-pin"
      data-pin-source="tree"
      :data-field="pinField"
      :aria-pressed="pinned"
      :aria-label="pinned ? `Unpin ${topic}` : `Pin ${topic} to the top`"
      :title="pinned ? 'Unpin' : 'Pin to the top'"
      :class="
        cn(
          'relative ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
          pinned ? 'text-foreground' : 'opacity-0 group-hover/row:opacity-100'
        )
      "
      @click.stop="emit('pin')"
      @dblclick.stop
    >
      <BookmarkIcon :class="cn('size-3', pinned && 'fill-current')" aria-hidden="true" />
    </button>

    <span
      :title="countTitle"
      :class="
        cn(
          'relative inline-flex h-4 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-[10px] leading-none text-muted-foreground tabular-nums',
          pinField === null && 'ml-auto',
          selected ? 'bg-background/80 dark:bg-background/40' : 'bg-muted'
        )
      "
    >
      {{ formatCompact(count) }}
    </span>
  </div>
</template>

<style scoped>
.topic-row-guides {
  background-image: linear-gradient(to right, var(--border) 1px, transparent 1px);
  background-size: 12px 100%;
  background-position: 7px 0;
}

.topic-row-flash {
  background-color: color-mix(in oklab, var(--primary) 16%, transparent);
  animation: topic-row-flash 700ms ease-out forwards;
}

@keyframes topic-row-flash {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .topic-row-flash {
    display: none;
  }
}
</style>
