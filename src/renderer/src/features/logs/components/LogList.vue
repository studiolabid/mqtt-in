<script setup lang="ts">
/**
 * Virtualized log list (dynamic row heights), newest at the bottom.
 *
 * - Sticks to the newest entry while scrolled to the end and `follow` is on; scrolling up stops
 *   following, a "newer" pill jumps back.
 * - Keyboard (when focused): ↑/↓ (j/k), PgUp/PgDn, Home/End move the cursor, Enter / Space /
 *   → / ← toggle the detail, C copies the entry, Esc clears the cursor.
 * - A listbox: the cursor row is its `aria-activedescendant`, rows are options that report
 *   selection, expansion and their position (`logRowAria`).
 * - Kept mounted while hidden (v-show): the scroll position is restored when shown again.
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type ComponentPublicInstance
} from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { ArrowDownIcon } from '@lucide/vue'
import type { LogEntry } from '@shared/models'
import { Button } from '@/components/ui/button'
import { useCopy, useFormatters } from '@/composables'
import { formatCompact } from '@/utils/format'
import LogRow from './LogRow.vue'
import { useLogListKeys } from '../composables/useLogListKeys'
import { logEntryToText, logTimestamp } from '../utils/log-text'
import { logRowId } from '../utils/row-aria'

const props = defineProps<{
  rows: readonly LogEntry[]
  search: string
  /** Auto-scroll: follow new entries while at the end. */
  follow: boolean
  /** Whether the panel is shown (its workspace tab is active). */
  visible: boolean
  /** Changes with the filter (re-anchors to the newest entry while following). */
  filterKey: string
}>()

const ROW_ESTIMATE = 26
/** Pixels from the end that still count as "at the end". */
const END_THRESHOLD = 8

const fmt = useFormatters()
const { copy } = useCopy()
const scroller = ref<HTMLElement | null>(null)
const expanded = shallowRef<ReadonlySet<number>>(new Set())
const activeId = ref<number | null>(null)

const virtualizer = useVirtualizer<HTMLElement, HTMLElement>(
  computed(() => {
    const list = props.rows
    return {
      count: list.length,
      getScrollElement: () => scroller.value,
      estimateSize: () => ROW_ESTIMATE,
      getItemKey: (index: number) => list[index]?.id ?? index,
      overscan: 10,
      paddingStart: 4,
      paddingEnd: 4,
      anchorTo: 'end' as const,
      followOnAppend: props.follow,
      scrollEndThreshold: END_THRESHOLD
    }
  })
)

const visibleRows = computed(() => {
  const list = props.rows
  return virtualizer.value.getVirtualItems().flatMap((item) => {
    const entry = list[item.index]
    return entry ? [{ item, entry }] : []
  })
})
const totalSize = computed(() => virtualizer.value.getTotalSize())
/** The cursor row, while it is rendered (the virtualizer reveals it on every move). */
const activeDescendant = computed(() => {
  const id = activeId.value
  if (id === null) return undefined
  return visibleRows.value.some(({ entry }) => entry.id === id) ? logRowId(id) : undefined
})
const offset = computed(() => visibleRows.value[0]?.item.start ?? 0)

function measure(el: Element | ComponentPublicInstance | null): void {
  virtualizer.value.measureElement(el instanceof HTMLElement ? el : null)
}

// --- Following & the "newer" pill ------------------------------------------

const atEnd = computed(() => props.rows.length === 0 || virtualizer.value.isAtEnd())
const newer = computed(() => {
  const end = virtualizer.value.range?.endIndex
  return end === undefined ? 0 : Math.max(0, props.rows.length - 1 - end)
})
const showJump = ref(false)
let jumpTimer: ReturnType<typeof setTimeout> | undefined

// Debounced so the pill never flashes while the list catches up with new entries.
watch(atEnd, (value) => {
  clearTimeout(jumpTimer)
  if (value) showJump.value = false
  else jumpTimer = setTimeout(() => (showJump.value = true), 150)
})

function scrollToEnd(): void {
  if (props.rows.length > 0) virtualizer.value.scrollToEnd()
}

function jumpToLatest(): void {
  scrollToEnd()
  scroller.value?.focus({ preventScroll: true })
}

/** Scroll state when the panel was hidden (an element hidden with v-show loses it). */
let resume = { atEnd: true, offset: 0 }

watch(
  () => props.visible,
  (visible) => {
    const el = scroller.value
    if (!visible) {
      // Pre-flush: the list is still laid out.
      if (el) {
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight
        resume = { atEnd: distance <= END_THRESHOLD, offset: el.scrollTop }
      }
      return
    }
    void nextTick(() => {
      if (resume.atEnd) scrollToEnd()
      else virtualizer.value.scrollToOffset(resume.offset)
    })
  }
)

watch(
  () => props.follow,
  (follow) => {
    if (follow && props.visible) scrollToEnd()
  }
)

watch(
  () => props.filterKey,
  () => {
    if (props.follow && props.visible) void nextTick(scrollToEnd)
  }
)

onMounted(() => {
  if (props.visible) void nextTick(scrollToEnd)
})
onBeforeUnmount(() => clearTimeout(jumpTimer))

// --- Cursor, expansion, keyboard --------------------------------------------

function toggle(entry: LogEntry, open?: boolean): void {
  if (!entry.detail) return
  const next = new Set(expanded.value)
  if (open ?? !next.has(entry.id)) next.add(entry.id)
  else next.delete(entry.id)
  expanded.value = next
}

function textSelected(): boolean {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== ''
}

function onActivate(entry: LogEntry, event: MouseEvent): void {
  activeId.value = entry.id
  // Selecting text (or the second click of a double click) must not toggle the detail.
  if (event.detail > 1 || textSelected()) return
  toggle(entry)
}

function copyEntry(entry: LogEntry): void {
  void copy(logEntryToText(entry), 'log entry')
}

const onKeydown = useLogListKeys({
  rows: () => props.rows,
  activeId,
  range: () => virtualizer.value.range,
  reveal: (index) => virtualizer.value.scrollToIndex(index, { align: 'auto' }),
  toggle,
  copy: copyEntry,
  hasSelection: textSelected
})
</script>

<template>
  <div class="relative min-h-0 flex-1">
    <div
      ref="scroller"
      data-testid="log-list"
      role="listbox"
      aria-label="Log entries"
      :aria-activedescendant="activeDescendant"
      tabindex="0"
      class="group/list scrollbar-slim absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      @keydown="onKeydown"
    >
      <div class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div class="absolute inset-x-0 top-0" :style="{ transform: `translateY(${offset}px)` }">
          <div
            v-for="{ item, entry } in visibleRows"
            :key="entry.id"
            :ref="measure"
            :data-index="item.index"
          >
            <LogRow
              :entry="entry"
              :time="fmt.clock(entry.timestamp)"
              :stamp="logTimestamp(entry.timestamp)"
              :expanded="expanded.has(entry.id)"
              :active="activeId === entry.id"
              :search="search"
              :index="item.index"
              :total="rows.length"
              @activate="onActivate"
            />
          </div>
        </div>
      </div>
    </div>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-1 opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="translate-y-1 opacity-0"
    >
      <Button
        v-if="showJump"
        type="button"
        size="xs"
        variant="secondary"
        class="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border pr-2.5 pl-2 font-normal shadow-md"
        @click="jumpToLatest"
      >
        <ArrowDownIcon aria-hidden="true" />
        <span class="tabular-nums">
          {{ newer > 0 ? `${formatCompact(newer)} newer` : 'Jump to latest' }}
        </span>
      </Button>
    </Transition>
  </div>
</template>
