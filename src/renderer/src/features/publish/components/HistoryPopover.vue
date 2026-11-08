<script setup lang="ts">
/**
 * Publish history of a connection, newest first. Click / Enter loads an entry into the draft,
 * Delete removes it, ↑ / ↓ move between entries; "Clear" asks first. A filter appears once
 * the list gets long.
 *
 * `open` and `reference` let the publisher open it from its "More" menu (narrow header), placed
 * against that menu's button while this trigger is folded away.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { HistoryIcon, SearchIcon, SendIcon } from '@lucide/vue'
import { EmptyState, HintTooltip } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { usePublishStore, useUiStore } from '@/stores'
import type { PublishHistoryItem } from '@/types'
import { formatNumber } from '@/utils/format'
import HistoryRow from './HistoryRow.vue'

const props = defineProps<{
  connectionId: string
  connected: boolean
  /** Position against this element instead of the trigger (the trigger is folded away). */
  reference?: HTMLElement | null
}>()

const emit = defineEmits<{
  /** An entry was loaded into the draft. */
  loaded: []
  /** "Publish draft" from the empty state. */
  publish: []
}>()

/** The filter input appears above this many entries. */
const FILTER_THRESHOLD = 6

const publish = usePublishStore()
const ui = useUiStore()

const open = defineModel<boolean>('open', { default: false })
const query = ref('')
const list = ref<HTMLElement | null>(null)
const filterInput = ref<HTMLInputElement | null>(null)
const emptyBox = ref<HTMLElement | null>(null)
/** Focus moves on (editor, confirm dialog): do not return it to the trigger on close. */
let keepFocusOnClose = false

const items = computed(() => publish.history(props.connectionId))
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return items.value
  return items.value.filter(
    (item) =>
      item.topic.toLowerCase().includes(needle) || item.payload.toLowerCase().includes(needle)
  )
})
const showFilter = computed(() => items.value.length > FILTER_THRESHOLD)
const tooltip = computed(() =>
  items.value.length > 0 ? `History · ${formatNumber(items.value.length)}` : 'History'
)

watch(open, (isOpen) => {
  if (!isOpen) query.value = ''
})

// "Publish draft" from the empty state: the button disappears, continue on the new entry.
watch(
  () => items.value.length,
  (count, previous) => {
    if (open.value && previous === 0 && count > 0) void nextTick(() => focusRow(0))
  }
)

function rows(): HTMLElement[] {
  return Array.from(list.value?.querySelectorAll<HTMLElement>('[data-row]') ?? [])
}

function focusRow(index: number): void {
  const all = rows()
  if (all.length === 0) return
  all[Math.max(0, Math.min(index, all.length - 1))].focus()
}

function focusFirst(): void {
  if (filterInput.value) filterInput.value.focus()
  else if (items.value.length > 0) focusRow(0)
  else emptyBox.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
}

function onOpenAutoFocus(event: Event): void {
  event.preventDefault()
  void nextTick(focusFirst)
}

function onCloseAutoFocus(event: Event): void {
  if (!keepFocusOnClose) return
  keepFocusOnClose = false
  event.preventDefault()
}

function close(keepFocus: boolean): void {
  keepFocusOnClose = keepFocus
  open.value = false
}

function load(item: PublishHistoryItem): void {
  publish.loadFromHistory(props.connectionId, item.id)
  close(true)
  emit('loaded')
}

function remove(item: PublishHistoryItem, index: number): void {
  // The row (keyboard) or its remove button (mouse) had focus: keep it in the list.
  const hadFocus = list.value?.contains(document.activeElement) ?? false
  publish.removeHistoryItem(props.connectionId, item.id)
  if (hadFocus) void nextTick(() => (rows().length > 0 ? focusRow(index) : focusFirst()))
}

async function clearAll(): Promise<void> {
  const total = items.value.length
  close(true)
  const confirmed = await ui.confirmDestructive({
    title: 'Clear publish history?',
    description: `${formatNumber(total)} ${total === 1 ? 'entry' : 'entries'} of this connection will be removed.`,
    confirmText: 'Clear history'
  })
  if (confirmed) publish.clearHistory(props.connectionId)
}

function onListKeydown(event: KeyboardEvent): void {
  const all = rows()
  const index = all.indexOf(document.activeElement as HTMLElement)
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      focusRow(index + 1)
      break
    case 'ArrowUp':
      event.preventDefault()
      if (index <= 0 && showFilter.value) focusFirst()
      else focusRow(index - 1)
      break
    case 'Home':
      event.preventDefault()
      focusRow(0)
      break
    case 'End':
      event.preventDefault()
      focusRow(all.length - 1)
      break
    case 'Delete':
    case 'Backspace': {
      const item = filtered.value[index]
      if (index < 0 || !item) return
      event.preventDefault()
      remove(item, index)
      break
    }
  }
}

function onFilterKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusRow(0)
  } else if (event.key === 'Enter' && filtered.value.length > 0) {
    event.preventDefault()
    load(filtered.value[0])
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <HintTooltip :label="tooltip">
      <PopoverTrigger as-child>
        <Button data-testid="publish-history" variant="ghost" size="icon-sm" aria-label="History">
          <HistoryIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
    </HintTooltip>
    <PopoverContent
      data-testid="publish-history-panel"
      align="end"
      :side-offset="6"
      :reference="reference ?? undefined"
      class="w-[26rem] max-w-[min(26rem,var(--reka-popover-content-available-width))] gap-0 p-0"
      @open-auto-focus="onOpenAutoFocus"
      @close-auto-focus="onCloseAutoFocus"
    >
      <div class="flex h-10 shrink-0 items-center gap-2 border-b pr-1.5 pl-3">
        <PopoverTitle class="text-sm">History</PopoverTitle>
        <span
          v-if="items.length > 0"
          class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-muted px-1.5 font-mono text-[11px] leading-none text-muted-foreground tabular-nums"
        >
          {{ formatNumber(items.length) }}
        </span>
        <Button
          v-if="items.length > 0"
          variant="ghost"
          size="xs"
          class="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          @click="clearAll"
        >
          Clear
        </Button>
      </div>

      <div v-if="items.length === 0" ref="emptyBox">
        <EmptyState
          compact
          :icon="HistoryIcon"
          title="Nothing published yet"
          description="Every message you publish is kept here. Pick one to load it back."
          class="py-6"
        >
          <Button size="sm" :disabled="!connected" @click="emit('publish')">
            <SendIcon aria-hidden="true" />
            Publish draft
          </Button>
        </EmptyState>
      </div>

      <template v-else>
        <label v-if="showFilter" class="flex h-9 items-center gap-2 border-b px-3">
          <SearchIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref="filterInput"
            v-model="query"
            type="text"
            placeholder="Filter by topic or payload"
            aria-label="Filter history"
            autocomplete="off"
            spellcheck="false"
            class="h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            @keydown="onFilterKeydown"
          />
        </label>
        <div
          ref="list"
          role="list"
          aria-label="Published messages"
          class="scrollbar-slim flex max-h-80 flex-col gap-px overflow-y-auto p-1"
          @keydown="onListKeydown"
        >
          <HistoryRow
            v-for="(item, index) in filtered"
            :key="item.id"
            role="listitem"
            :item="item"
            :index="index"
            @load="load(item)"
            @remove="remove(item, index)"
          />
          <p
            v-if="filtered.length === 0"
            class="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            No entry matches “{{ query.trim() }}”.
          </p>
        </div>
        <p
          class="flex h-8 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground"
          aria-hidden="true"
        >
          <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span class="flex items-center gap-1"><Kbd>Enter</Kbd> load</span>
          <span class="flex items-center gap-1"><Kbd>Del</Kbd> remove</span>
        </p>
      </template>
    </PopoverContent>
  </Popover>
</template>
