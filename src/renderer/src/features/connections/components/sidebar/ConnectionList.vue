<script setup lang="ts">
/**
 * The grouped connection list: ungrouped profiles first (no header), then collapsible groups.
 * Search filters by name / host:port / group and forces groups open. Keyboard: arrows / Home /
 * End move, Enter opens, F2 edits, Delete deletes, Alt+↑/↓ reorders within the group,
 * ←/→ collapse / expand groups. Items are reordered by drag & drop (not while searching).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { SearchXIcon } from '@lucide/vue'
import { EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { hostPlatform } from '@/composables/useHotkey'
import { useNavigation } from '@/composables/useNavigation'
import { useConnectionsStore } from '@/stores/connections'
import { useSessionsStore } from '@/stores/sessions'
import type { CollapsedGroups } from '../../composables/useCollapsedGroups'
import { useConnectionActions } from '@/composables/useConnectionActions'
import { useConnectionDnd } from '../../composables/useConnectionDnd'
import { useListKeyboard } from '../../composables/useListKeyboard'
import { filterGroups, searchTerms } from '../../utils/filter'
import { moveId } from '../../utils/order'
import ConnectionGroupHeader from './ConnectionGroupHeader.vue'
import ConnectionListItem from './ConnectionListItem.vue'

const props = defineProps<{
  query: string
  collapsed: CollapsedGroups
}>()

const emit = defineEmits<{ clearSearch: [] }>()

const connections = useConnectionsStore()
const sessions = useSessionsStore()
const navigation = useNavigation()
const actions = useConnectionActions()
const mac = hostPlatform() === 'darwin'

const root = ref<HTMLElement | null>(null)
const terms = computed(() => searchTerms(props.query))
const searching = computed(() => terms.value.length > 0)
const groups = computed(() => filterGroups(connections.groups, terms.value))
const currentId = computed(() => navigation.currentConnectionId.value)

function isOpen(name: string): boolean {
  return name === '' || searching.value || !props.collapsed.isCollapsed(name)
}

const visibleIds = computed(() =>
  groups.value.flatMap((group) => (isOpen(group.name) ? group.profiles.map((p) => p.id) : []))
)

const { tabStopId, onFocusItem, navigate, focusItem, focusFirst } = useListKeyboard({
  root,
  visibleIds: () => visibleIds.value,
  preferredId: () => currentId.value
})

const { draggingId, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd, onDragLeave } =
  useConnectionDnd({
    enabled: () => !searching.value,
    order: () => connections.profiles.map((profile) => profile.id),
    groupOf: (id) => connections.get(id)?.group.trim(),
    reorder: (ids) => void connections.reorder(ids)
  })

function connectedIn(profiles: readonly { id: string }[]): number {
  return profiles.filter((profile) => sessions.isConnected(profile.id)).length
}

/** Alt+↑ / Alt+↓: moves a connection one place within its group. */
function moveWithinGroup(id: string, direction: -1 | 1): void {
  const name = connections.get(id)?.group.trim()
  const siblings = connections.groups.find((group) => group.name === name)?.profiles ?? []
  const index = siblings.findIndex((profile) => profile.id === id)
  const neighbor = siblings[index + direction]
  if (index === -1 || !neighbor) return
  const order = connections.profiles.map((profile) => profile.id)
  void connections.reorder(moveId(order, id, neighbor.id, direction < 0 ? 'before' : 'after'))
  focusItem(id) // the moved element loses focus when the list is re-ordered
}

/** Delete key: after the deletion, focus moves to the neighbor instead of getting lost. */
async function removeFocused(id: string): Promise<void> {
  const ids = visibleIds.value
  const index = ids.indexOf(id)
  const neighbor = ids[index + 1] ?? ids[index - 1]
  await actions.remove(id)
  if (!connections.get(id) && neighbor) focusItem(neighbor)
}

function onItemKeydown(event: KeyboardEvent, id: string): boolean {
  const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
  if (event.altKey && !event.ctrlKey && !event.metaKey && /^Arrow(Up|Down)$/.test(event.key)) {
    if (!searching.value) moveWithinGroup(id, event.key === 'ArrowUp' ? -1 : 1)
    return true
  }
  if (!plain) return false
  if (event.key === 'F2') {
    actions.edit(id)
    return true
  }
  if (event.key === 'Delete' || (mac && event.key === 'Backspace')) {
    void removeFocused(id)
    return true
  }
  if (event.key === 'ArrowLeft') {
    // Tree-like: from an item to its group header.
    const name = connections.get(id)?.group.trim()
    if (!name) return false
    const header = Array.from(
      root.value?.querySelectorAll<HTMLElement>('[data-group-header]') ?? []
    ).find((element) => element.dataset.group === name)
    header?.focus()
    return Boolean(header)
  }
  return false
}

function onHeaderKeydown(event: KeyboardEvent, name: string): boolean {
  if (searching.value || event.altKey || event.ctrlKey || event.metaKey) return false
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    props.collapsed.setCollapsed(name, event.key === 'ArrowLeft')
    return true
  }
  return false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return
  const target = event.target instanceof Element ? event.target : null
  const id = target?.closest<HTMLElement>('[data-connection-id]')?.dataset.connectionId
  const group = target?.closest<HTMLElement>('[data-group-header]')?.dataset.group
  const handled =
    (id !== undefined && onItemKeydown(event, id)) ||
    (group !== undefined && onHeaderKeydown(event, group)) ||
    navigate(event)
  if (handled) event.preventDefault()
}

// Keep the open connection visible (restored at startup, opened from the command palette…).
watch(
  currentId,
  (id) => {
    if (!id) return
    void nextTick(() =>
      root.value
        ?.querySelector(`[data-connection-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    )
  },
  { immediate: true }
)

defineExpose({
  /** Moves keyboard focus to the first row. */
  focusFirst,
  /** Opens the first visible connection (Enter in the search field). */
  openFirst: (): boolean => {
    const first = visibleIds.value[0]
    if (first) actions.open(first)
    return Boolean(first)
  }
})
</script>

<template>
  <div
    ref="root"
    class="overflow-y-auto px-2 pt-1 pb-2 scrollbar-slim"
    @keydown="onKeydown"
    @dragleave="onDragLeave"
  >
    <EmptyState
      v-if="searching && groups.length === 0"
      compact
      :icon="SearchXIcon"
      title="No matches"
      description="No connection name, host or group matches your search."
      class="pt-8"
    >
      <Button size="sm" variant="outline" @click="emit('clearSearch')">Clear search</Button>
    </EmptyState>
    <!-- Ungrouped profiles come first and have no header (their "group" is always open). -->
    <Collapsible
      v-for="group in groups"
      :key="'group:' + group.name"
      :open="isOpen(group.name)"
      :disabled="searching || group.name === ''"
      :class="group.name === '' ? undefined : 'mt-2 first:mt-0'"
      @update:open="(open: boolean) => collapsed.setCollapsed(group.name, !open)"
    >
      <ConnectionGroupHeader
        v-if="group.name !== ''"
        :name="group.name"
        :count="group.profiles.length"
        :connected="connectedIn(group.profiles)"
        :open="isOpen(group.name)"
        :collapsible="!searching"
        :current="group.profiles.some((profile) => profile.id === currentId)"
        :tab-stop="tabStopId === null && group === groups[0]"
      />
      <CollapsibleContent
        class="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
      >
        <div
          role="list"
          :aria-label="group.name || 'Connections without a group'"
          :class="['flex flex-col gap-0.5', group.name !== '' && 'pt-0.5']"
        >
          <ConnectionListItem
            v-for="profile in group.profiles"
            :key="profile.id"
            :profile="profile"
            :active="profile.id === currentId"
            :terms="terms"
            :tab-stop="profile.id === tabStopId"
            :draggable="!searching"
            :dragging="draggingId === profile.id"
            :drop-position="dropTarget?.id === profile.id ? dropTarget.position : null"
            @focusin="onFocusItem(profile.id)"
            @dragstart="onDragStart(profile.id, $event)"
            @dragover="onDragOver(profile.id, $event)"
            @drop="onDrop(profile.id, $event)"
            @dragend="onDragEnd"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>
