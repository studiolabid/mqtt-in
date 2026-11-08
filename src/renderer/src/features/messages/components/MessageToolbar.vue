<script setup lang="ts">
/**
 * Message toolbar (h-10): search, topic / direction / retained / subscription filters, payload
 * view format, pause, auto-scroll, clear, export and "more"; counters at the right end.
 * Container queries drop secondary controls on narrow panels; they stay in the "More" menu.
 *
 * A labelled group, not an ARIA toolbar (A11Y-23): every control is its own Tab stop. After
 * "Clear messages" hides the list, the focus moves to the empty state's action or the search
 * field instead of falling back to the page (A11Y-11).
 */
import { computed, nextTick, ref } from 'vue'
import { ListEndIcon, BracesIcon, PinIcon, Trash2Icon } from '@lucide/vue'
import type { MqttMessage } from '@shared/models'
import { VIEW_FORMATS } from '@shared/payload'
import { IconButton, SearchInput } from '@/components/common'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type MessageList, useConnectionActions, useHotkey, useThrottledValue } from '@/composables'
import { useMessagesStore, useUiStore } from '@/stores'
import { focusFirst, isFocusable } from '@/utils/focus'
import { isMessageFilterActive } from '@/utils/message-filter'
import { SHORTCUTS } from '@/utils/shortcuts'
import { useAutoScroll } from '../composables/useAutoScroll'
import { useDebouncedModel } from '../composables/useDebouncedModel'
import { useSearching } from '../composables/useSearching'
import { isViewFormat } from '../utils/message-meta'
import DirectionFilter from './DirectionFilter.vue'
import MessageExportMenu from './MessageExportMenu.vue'
import MessageMoreMenu from './MessageMoreMenu.vue'
import MessageStats from './MessageStats.vue'
import PauseButton from './PauseButton.vue'
import SubscriptionFilterChip from './SubscriptionFilterChip.vue'
import TopicFilterInput from './TopicFilterInput.vue'

const props = defineProps<{
  connectionId: string
  list: MessageList
}>()

const ui = useUiStore()
const messages = useMessagesStore()
const actions = useConnectionActions()
const autoScroll = useAutoScroll(() => props.connectionId)

const root = ref<HTMLElement | null>(null)
const search = ref<InstanceType<typeof SearchInput> | null>(null)

const filter = computed(() => ui.messageFilter(props.connectionId))
const filterActive = computed(() => isMessageFilterActive(filter.value))
const format = computed(() => ui.viewFormat(props.connectionId))
const matched = useThrottledValue(() => props.list.matched.value, 250)
const total = useThrottledValue(() => props.list.total.value, 250)
/** A re-filtering pass over a large buffer is still running (the count is not final yet). */
const searching = useSearching(() => props.list.pending.value)

const { model: searchModel } = useDebouncedModel(
  () => filter.value.search,
  (value) => ui.updateMessageFilter(props.connectionId, { search: value })
)

const onMessagesTab = (): boolean => ui.workspaceTab(props.connectionId) === 'messages'
const getRows = (): readonly MqttMessage[] => props.list.rows.value

function focusSearch(): void {
  search.value?.select()
}

function setFormat(value: unknown): void {
  if (isViewFormat(value)) ui.setViewFormat(props.connectionId, value)
}

/** Where the focus goes once the cleared list is hidden. */
const AFTER_CLEAR_FOCUS = [
  '[data-testid="message-empty-state"] [data-primary-action]:not(:disabled)',
  '[data-testid="message-search"]'
] as const
/** A confirm dialog restores the focus after its exit animation: check again after it. */
const DIALOG_CLOSE_MS = 300

function focusLost(): boolean {
  const active = document.activeElement
  return !(active instanceof HTMLElement) || active === document.body || !isFocusable(active)
}

function recoverFocus(): void {
  const panel = root.value?.closest('[data-testid="message-panel"]') ?? undefined
  if (focusLost()) void focusFirst(AFTER_CLEAR_FOCUS, panel)
}

async function clearMessages(): Promise<void> {
  await actions.clearMessages(props.connectionId)
  if (messages.count(props.connectionId) > 0) return
  void nextTick(recoverFocus)
  setTimeout(recoverFocus, DIALOG_CLOSE_MS)
}

const tabHotkey = { enabled: onMessagesTab, ignoreInDialogs: true }
useHotkey(SHORTCUTS.search.combo, focusSearch, tabHotkey)
useHotkey(SHORTCUTS.clearMessages.combo, () => void clearMessages(), tabHotkey)

defineExpose({ focusSearch })
</script>

<template>
  <div
    ref="root"
    role="group"
    aria-label="Message filters and actions"
    class="@container/toolbar flex h-10 shrink-0 items-center gap-2 overflow-hidden border-b px-3"
  >
    <div class="flex min-w-28 flex-1 @4xl/toolbar:max-w-96">
      <SearchInput
        ref="search"
        v-model="searchModel"
        data-testid="message-search"
        size="sm"
        placeholder="Search topic or payload…"
        :shortcut="SHORTCUTS.search.keys"
        class="w-full"
      />
    </div>
    <TopicFilterInput :connection-id="connectionId" />
    <DirectionFilter :connection-id="connectionId" class="hidden @xl/toolbar:flex" />
    <Tooltip>
      <TooltipTrigger as-child>
        <Toggle
          data-testid="retained-filter"
          variant="outline"
          size="sm"
          :model-value="filter.retainedOnly"
          aria-label="Retained messages only"
          class="hidden h-7 min-w-7 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground aria-pressed:text-foreground @2xl/toolbar:inline-flex"
          @update:model-value="
            (value) => ui.updateMessageFilter(connectionId, { retainedOnly: value })
          "
        >
          <PinIcon aria-hidden="true" />
          <span class="hidden @5xl/toolbar:inline">Retained</span>
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Retained messages only</TooltipContent>
    </Tooltip>
    <SubscriptionFilterChip :connection-id="connectionId" />

    <div class="ml-auto flex shrink-0 items-center gap-0.5">
      <Select :model-value="format" @update:model-value="setFormat">
        <Tooltip>
          <TooltipTrigger as-child>
            <SelectTrigger
              size="sm"
              aria-label="Payload view format"
              class="hidden min-w-24 gap-1.5 px-2 text-xs @4xl/toolbar:flex"
            >
              <BracesIcon class="size-3.5 text-muted-foreground" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent>View payloads as</TooltipContent>
        </Tooltip>
        <SelectContent position="popper" align="end">
          <SelectItem v-for="item in VIEW_FORMATS" :key="item.value" :value="item.value">
            {{ item.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Separator orientation="vertical" class="mx-1.5 hidden h-4 @4xl/toolbar:block" />
      <PauseButton :connection-id="connectionId" />
      <Tooltip>
        <TooltipTrigger as-child>
          <Toggle
            size="sm"
            :model-value="autoScroll.enabled.value"
            aria-label="Auto-scroll to new messages"
            class="hidden size-7 min-w-7 px-0 text-muted-foreground hover:text-foreground aria-pressed:text-foreground @4xl/toolbar:inline-flex"
            @update:model-value="autoScroll.set"
          >
            <ListEndIcon aria-hidden="true" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent> Auto-scroll {{ autoScroll.enabled.value ? 'on' : 'off' }} </TooltipContent>
      </Tooltip>
      <IconButton
        data-testid="messages-clear"
        label="Clear messages"
        :shortcut="SHORTCUTS.clearMessages.keys"
        :disabled="total === 0"
        @click="void clearMessages()"
      >
        <Trash2Icon />
      </IconButton>
      <MessageExportMenu
        :connection-id="connectionId"
        :get-rows="getRows"
        :filter-active="filterActive"
        :matched="matched"
        :total="total"
      />
      <MessageMoreMenu
        :connection-id="connectionId"
        :filter-active="filterActive"
        :matched="matched"
        :total="total"
      />
    </div>
    <MessageStats
      :connection-id="connectionId"
      :filter-active="filterActive"
      :matched="matched"
      :total="total"
      :searching="searching"
    />
  </div>
</template>
