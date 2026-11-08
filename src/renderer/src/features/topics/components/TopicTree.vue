<script setup lang="ts">
/**
 * The live topic tree: toolbar, virtualized rows (28 px), keyboard navigation on the focused
 * tree (selection follows the keyboard), context menu, and reveal of topics selected elsewhere
 * (e.g. "show in topic tree" from a message): their ancestors are expanded and scrolled to.
 *
 * - Shift+F10 / the Menu key open the selected row's menu at that row (A11Y-14).
 * - Rows carry their sibling position (`aria-posinset` / `aria-setsize`) and a pin for numeric
 *   values (FP-3).
 * - Large trees (PERF-07): the virtualizer's item keys read a captured rows array (not the
 *   reactive props on every measurement), and the search's match count comes from
 *   `useTopicTreeRows` (`matchCount`) instead of lower-casing every row again.
 */
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { SearchXIcon } from '@lucide/vue'
import type { ViewFormat } from '@shared/models'
import { EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useHotkey } from '@/composables/useHotkey'
import { previewOf } from '@/composables/usePayloadPreview'
import { useMessagesStore } from '@/stores/messages'
import { useUiStore } from '@/stores/ui'
import { SHORTCUTS } from '@/utils/shortcuts'
import type { TopicRow } from '@/utils/topic-tree'
import { topicExplorerState } from '../composables/explorer-state'
import { pinFieldOf, usePinToggle } from '../composables/usePinnedSeries'
import { useTopicActions } from '../composables/useTopicActions'
import { useTreeExpansion } from '../composables/useTreeExpansion'
import { useTreeMenu } from '../composables/useTreeMenu'
import { ancestorTopics } from '../utils/topic-path'
import { indexOfTopic, treeKeyAction, type TreeAction } from '../utils/tree-nav'
import { treeRowView, type TreeRowView } from '../utils/tree-views'
import TopicRowMenu from './TopicRowMenu.vue'
import TopicTreeRow from './TopicTreeRow.vue'
import TopicTreeToolbar from './TopicTreeToolbar.vue'

const ROW_HEIGHT = 28
/** Space above the first and below the last row, in px. */
const LIST_PADDING = 4
const PREVIEW_CHARS = 160

const props = defineProps<{
  connectionId: string
  /** Flattened rows (`useTopicTreeRows`); they hold live nodes, read only for display. */
  rows: readonly TopicRow[]
  topicCount: number
  /** Matching topics with messages, counted while flattening (`useTopicTreeRows`). */
  matchCount: number
  /** The (debounced) search term the rows were filtered with. */
  searchTerm: string
}>()

const ui = useUiStore()
const messages = useMessagesStore()
const actions = useTopicActions(() => props.connectionId)
const expansion = useTreeExpansion(() => props.connectionId)
const pins = usePinToggle(() => props.connectionId)
const state = computed(() => topicExplorerState(props.connectionId))
const uid = useId()

const toolbar = ref<InstanceType<typeof TopicTreeToolbar> | null>(null)
const scroller = ref<HTMLElement | null>(null)

const selected = computed(() => ui.selectedTopic(props.connectionId))
const searching = computed(() => props.searchTerm.trim().length > 0)
const paused = computed(() => messages.isPaused(props.connectionId))

const virtualizer = useVirtualizer(
  computed(() => {
    // Captured once per rows update: item keys never go through the reactive props.
    const list = props.rows
    return {
      count: list.length,
      getScrollElement: () => scroller.value,
      estimateSize: () => ROW_HEIGHT,
      overscan: 12,
      paddingStart: LIST_PADDING,
      paddingEnd: LIST_PADDING,
      getItemKey: (index: number) => list[index]?.node.topic ?? index,
      initialOffset: () => state.value.scrollTop
    }
  })
)

const selectedIndex = computed(() => indexOfTopic(props.rows, selected.value))

const menu = useTreeMenu({
  connectionId: () => props.connectionId,
  scroller,
  rows: () => props.rows,
  selected: () => selected.value,
  selectedIndex: () => selectedIndex.value,
  select,
  ensureVisible(index) {
    if (!inView(index)) virtualizer.value.scrollToIndex(index, { align: 'auto' })
  }
})

function toView(row: TopicRow, start: number, format: ViewFormat): TreeRowView {
  const { lastMessage } = row.node
  const field = pinFieldOf(lastMessage)
  return treeRowView(row, start, lastMessage ? previewOf(lastMessage, format, PREVIEW_CHARS) : '', {
    field,
    pinned: field !== null && pins.isPinned(row.node.topic, field)
  })
}

/** Plain display data of the rendered rows (previews only for these). */
const visible = computed(() => {
  const format = ui.viewFormat(props.connectionId)
  const items: Array<{ index: number; view: TreeRowView }> = []
  for (const item of virtualizer.value.getVirtualItems()) {
    const row = props.rows[item.index]
    if (row) items.push({ index: item.index, view: toView(row, item.start, format) })
  }
  return items
})

/** The toolbar's "N matches" while searching. */
const matchCount = computed(() => (searching.value ? props.matchCount : null))

const rowId = (index: number): string => `${uid}-row-${index}`
const activeId = computed(() =>
  visible.value.some((item) => item.index === selectedIndex.value)
    ? rowId(selectedIndex.value)
    : undefined
)

function select(topic: string): void {
  state.value.treeSelection = topic
  ui.selectTopic(props.connectionId, topic)
}

function apply(action: TreeAction): void {
  const row = props.rows[action.index]
  if (!row) return
  if (action.kind === 'toggle') expansion.setExpanded(row.node.topic, action.expand)
  if (row.node.topic !== selected.value) select(row.node.topic)
  virtualizer.value.scrollToIndex(action.index, { align: 'auto' })
}

function pageSize(): number {
  const height = scroller.value?.clientHeight ?? ROW_HEIGHT * 10
  return Math.max(1, Math.floor(height / ROW_HEIGHT) - 1)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.altKey) return
  if (event.ctrlKey || event.metaKey) {
    if (!event.shiftKey && event.key.toLowerCase() === 'c' && selected.value !== null) {
      event.preventDefault()
      actions.copyTopic(selected.value)
    }
    return
  }
  const action = treeKeyAction(event.key, props.rows, selectedIndex.value, {
    searching: searching.value,
    pageSize: pageSize()
  })
  if (!action) return
  event.preventDefault()
  apply(action)
}

/** ArrowDown in the search field continues in the tree. */
function enterTree(): void {
  scroller.value?.focus()
  if (selectedIndex.value < 0 && props.rows.length > 0) apply({ kind: 'select', index: 0 })
}

/** Whether the row at `index` is fully inside the scroll viewport. */
function inView(index: number): boolean {
  const element = scroller.value
  if (!element) return false
  const top = LIST_PADDING + index * ROW_HEIGHT
  return top >= element.scrollTop && top + ROW_HEIGHT <= element.scrollTop + element.clientHeight
}

/**
 * Makes `topic` visible: expands its ancestors (outside of a search) and centers it, unless
 * it is already on screen.
 */
function reveal(topic: string, expand: boolean): void {
  if (expand && !searching.value) {
    for (const ancestor of ancestorTopics(topic)) state.value.expanded.add(ancestor)
  }
  void nextTick(() => {
    const index = indexOfTopic(props.rows, topic)
    if (index >= 0 && !inView(index)) virtualizer.value.scrollToIndex(index, { align: 'center' })
  })
}

function onScroll(): void {
  if (scroller.value) state.value.scrollTop = scroller.value.scrollTop
}

watch(selected, (topic) => {
  if (topic !== null && topic !== state.value.treeSelection) reveal(topic, true)
})

onMounted(() => {
  const topic = selected.value
  if (topic !== null) reveal(topic, topic !== state.value.treeSelection)
})

useHotkey(SHORTCUTS.search.combo, () => toolbar.value?.focusSearch(), {
  ignoreInDialogs: true,
  enabled: () => ui.workspaceTab(props.connectionId) === 'topics'
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <TopicTreeToolbar
      ref="toolbar"
      v-model:search="state.search.value"
      :topic-count="topicCount"
      :match-count="matchCount"
      :paused="paused"
      :searching="searching"
      @expand-all="expansion.expandAll"
      @collapse-all="expansion.collapseAll"
      @resume="messages.setPaused(connectionId, false)"
      @enter-tree="enterTree"
    />
    <div class="relative min-h-0 flex-1">
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <div
            ref="scroller"
            role="tree"
            tabindex="0"
            data-testid="topic-tree"
            aria-label="Topics"
            :aria-activedescendant="activeId"
            :class="[
              'group/tree absolute inset-0 overflow-x-hidden overflow-y-auto outline-none scrollbar-slim',
              selectedIndex < 0 &&
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
            ]"
            @keydown="onKeydown"
            @scroll.passive="onScroll"
            @contextmenu.capture="menu.onContextMenu"
          >
            <div class="relative w-full" :style="{ height: `${virtualizer.getTotalSize()}px` }">
              <TopicTreeRow
                v-for="item in visible"
                :id="rowId(item.index)"
                :key="item.view.topic"
                v-bind="item.view"
                :selected="item.view.topic === selected"
                :highlight="searchTerm"
                :searching="searching"
                @select="select(item.view.topic)"
                @toggle="expansion.toggle(item.view.topic)"
                @pin="
                  item.view.pinField !== null && pins.toggle(item.view.topic, item.view.pinField)
                "
              />
            </div>
          </div>
        </ContextMenuTrigger>
        <TopicRowMenu
          :connection-id="connectionId"
          :target="menu.target.value"
          @expand-branch="expansion.expandBranch"
          @collapse-branch="(topic: string) => expansion.setExpanded(topic, false)"
          @expand-all="expansion.expandAll"
          @collapse-all="expansion.collapseAll"
        />
      </ContextMenu>

      <EmptyState
        v-if="rows.length === 0"
        compact
        :icon="SearchXIcon"
        title="No matching topics"
        :description="`No topic contains “${searchTerm.trim()}”.`"
        class="absolute inset-0 bg-background"
      >
        <Button size="sm" variant="outline" @click="state.search.value = ''">Clear search</Button>
      </EmptyState>
    </div>
  </div>
</template>
