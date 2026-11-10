<script setup lang="ts">
/**
 * Saved messages, shared by every connection: "Save current" names the draft; a row loads its
 * message into the draft (Enter / click), Ctrl+Enter or ▶ publishes it as it is, Delete removes
 * it (undo in the toast). ↑ / ↓ move between rows; a filter appears once the list gets long.
 * In the payload editor the same names complete (`utils/saved-completion`).
 *
 * `open` and `reference` let the publisher open it from its "More" menu (narrow header), placed
 * against that menu's button while this trigger is folded away.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { BookmarkIcon, BookmarkPlusIcon, SearchIcon } from '@lucide/vue'
import { EmptyState, formatShortcutKey, HintTooltip, isMacPlatform } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { usePublishStore, useSavedMessagesStore } from '@/stores'
import type { SavedMessage } from '@/types'
import { formatNumber } from '@/utils/format'
import { filterSaved } from '@/utils/saved-messages'
import SavedForm from './SavedForm.vue'
import SavedRow from './SavedRow.vue'

const props = defineProps<{
  connectionId: string
  connected: boolean
  /** QoS is shown on the rows (MQTT connections). */
  showQos?: boolean
  /** Position against this element instead of the trigger (the trigger is folded away). */
  reference?: HTMLElement | null
}>()

const emit = defineEmits<{
  /** A message was loaded into the draft. */
  loaded: []
}>()

/** The filter input appears above this many entries. */
const FILTER_THRESHOLD = 6
const MOD_KEY = formatShortcutKey('mod', isMacPlatform())

const publish = usePublishStore()
const saved = useSavedMessagesStore()

const open = defineModel<boolean>('open', { default: false })
const query = ref('')
const saving = ref(false)
const list = ref<HTMLElement | null>(null)
const filterInput = ref<HTMLInputElement | null>(null)
const emptyBox = ref<HTMLElement | null>(null)
/** Focus moves on (the editor): do not return it to the trigger on close. */
let keepFocusOnClose = false

const items = computed(() => saved.sorted)
const filtered = computed(() => filterSaved(items.value, query.value))
const showFilter = computed(() => items.value.length > FILTER_THRESHOLD)
const draft = computed(() => publish.draft(props.connectionId))
const tooltip = computed(() =>
  items.value.length > 0 ? `Saved messages · ${formatNumber(items.value.length)}` : 'Saved messages'
)

watch(open, (isOpen) => {
  if (isOpen) return
  query.value = ''
  saving.value = false
})

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

function load(item: SavedMessage): void {
  publish.loadFromSaved(props.connectionId, item)
  keepFocusOnClose = true
  open.value = false
  emit('loaded')
}

async function send(item: SavedMessage): Promise<void> {
  if (!props.connected) return
  if (await publish.publishSaved(props.connectionId, item)) {
    const topic = item.topic || draft.value.topic
    toast.success(`Published ${item.name}`, { description: topic })
  }
}

function remove(item: SavedMessage, index: number): void {
  const hadFocus = list.value?.contains(document.activeElement) ?? false
  const removed = saved.remove(item.id)
  if (hadFocus) void nextTick(() => (rows().length > 0 ? focusRow(index) : focusFirst()))
  if (!removed) return
  toast.info(`Removed ${removed.name}`, {
    action: { label: 'Undo', onClick: () => void saved.restore(removed) },
    duration: ACTION_TOAST_DURATION
  })
}

function startSaving(): void {
  saving.value = true
}

function onSaved(name: string): void {
  saving.value = false
  query.value = ''
  void nextTick(() => {
    const index = filtered.value.findIndex((item) => item.name === name)
    focusRow(Math.max(0, index))
  })
}

function onCancelSaving(): void {
  saving.value = false
  void nextTick(focusFirst)
}

function onListKeydown(event: KeyboardEvent): void {
  const all = rows()
  const index = all.indexOf(document.activeElement as HTMLElement)
  const item = filtered.value[index]
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    if (!item) return
    event.preventDefault()
    void send(item)
    return
  }
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
    case 'Backspace':
      if (index < 0 || !item) return
      event.preventDefault()
      remove(item, index)
      break
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
        <Button
          data-testid="publish-saved"
          variant="ghost"
          size="icon-sm"
          aria-label="Saved messages"
        >
          <BookmarkIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
    </HintTooltip>
    <PopoverContent
      data-testid="publish-saved-panel"
      align="end"
      :side-offset="6"
      :reference="reference ?? undefined"
      class="w-[26rem] max-w-[min(26rem,var(--reka-popover-content-available-width))] gap-0 p-0"
      @open-auto-focus="onOpenAutoFocus"
      @close-auto-focus="onCloseAutoFocus"
    >
      <div class="flex h-10 shrink-0 items-center gap-2 border-b pr-1.5 pl-3">
        <PopoverTitle class="text-sm">Saved messages</PopoverTitle>
        <span
          v-if="items.length > 0"
          class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-muted px-1.5 font-mono text-[11px] leading-none text-muted-foreground tabular-nums"
        >
          {{ formatNumber(items.length) }}
        </span>
        <Button
          v-if="!saving"
          variant="ghost"
          size="xs"
          data-testid="publish-saved-new"
          class="ml-auto"
          @click="startSaving"
        >
          <BookmarkPlusIcon aria-hidden="true" />
          Save current
        </Button>
      </div>

      <SavedForm
        v-if="saving"
        :draft="draft"
        class="border-b"
        @saved="onSaved"
        @cancel="onCancelSaving"
      />

      <div v-if="items.length === 0" ref="emptyBox">
        <EmptyState
          v-if="!saving"
          compact
          :icon="BookmarkIcon"
          title="No saved messages"
          description="Save a message you send often under a short name. Then type that name in the payload and press Tab."
          class="py-6"
        >
          <Button size="sm" @click="startSaving">
            <BookmarkPlusIcon aria-hidden="true" />
            Save current draft
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
            placeholder="Filter by name, topic or payload"
            aria-label="Filter saved messages"
            autocomplete="off"
            spellcheck="false"
            class="h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            @keydown="onFilterKeydown"
          />
        </label>
        <div
          ref="list"
          role="list"
          aria-label="Saved messages"
          class="scrollbar-slim flex max-h-80 flex-col gap-px overflow-y-auto p-1"
          @keydown="onListKeydown"
        >
          <SavedRow
            v-for="(item, index) in filtered"
            :key="item.id"
            role="listitem"
            :item="item"
            :index="index"
            :connected="connected"
            :show-qos="showQos"
            @load="load(item)"
            @send="send(item)"
            @remove="remove(item, index)"
          />
          <p
            v-if="filtered.length === 0"
            class="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            No saved message matches “{{ query.trim() }}”.
          </p>
        </div>
        <p
          class="flex h-8 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground"
          aria-hidden="true"
        >
          <span class="flex items-center gap-1"><Kbd>Enter</Kbd> load</span>
          <span class="flex items-center gap-1"
            ><Kbd>{{ MOD_KEY }}</Kbd
            ><Kbd>Enter</Kbd> publish</span
          >
          <span class="flex items-center gap-1"><Kbd>Del</Kbd> remove</span>
        </p>
      </template>
    </PopoverContent>
  </Popover>
</template>
