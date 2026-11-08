<script setup lang="ts">
/**
 * Subscriptions of a connection (left column of the workspace): live state per filter, click
 * to filter the message list, a keyboard-driven list (arrows, Enter, Space, E, C, Delete,
 * Escape, Shift+F10), row menus, bulk actions and a throttled message counter per filter.
 * Deleting the last subscription moves focus to the empty state's "Add subscription" (A11Y-11).
 */
import { computed, nextTick, ref } from 'vue'
import { PlugIcon, PlusIcon, SatelliteDishIcon } from '@lucide/vue'
import type { Subscription } from '@shared/models'
import { KbdShortcut, PanelHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hostPlatform } from '@/composables'
import { useConnectionsStore, useSessionsStore, useSubscriptionsStore, useUiStore } from '@/stores'
import { focusFirst } from '@/utils/focus'
import { SHORTCUTS } from '@/utils/shortcuts'
import SubscriptionEmpty from './components/SubscriptionEmpty.vue'
import SubscriptionItem from './components/SubscriptionItem.vue'
import SubscriptionListMenu from './components/SubscriptionListMenu.vue'
import { useListCursor } from './composables/useListCursor'
import { useSubscriptionActions } from './composables/useSubscriptionActions'
import { useSubscriptionCounts } from './composables/useSubscriptionCounts'
import { createListKeydown, type CursorMove } from './utils/list-keys'
import { subscriptionDomId } from './utils/subscription-view'

const props = defineProps<{ connectionId: string }>()

const ui = useUiStore()
const subscriptions = useSubscriptionsStore()
const sessions = useSessionsStore()
const connections = useConnectionsStore()
const actions = useSubscriptionActions(() => props.connectionId)
const counts = useSubscriptionCounts(() => props.connectionId)
const platform = hostPlatform()

const subs = computed(() => subscriptions.list(props.connectionId))
const enabledCount = computed(() => subs.value.filter((sub) => sub.enabled).length)
const connected = computed(() => sessions.isConnected(props.connectionId))
/** Footer banner while the session is not connected (also explains the quick adds). */
const banner = computed(() => {
  if (connected.value) return null
  const status = sessions.statusOf(props.connectionId)
  return status === 'connecting' || status === 'reconnecting'
    ? 'Subscriptions are applied once connected'
    : 'Subscriptions are applied when you connect'
})
const profile = computed(() => connections.get(props.connectionId))
const mqtt5 = computed(() => profile.value?.protocolVersion === 5)
const filteredId = computed(() => ui.messageFilter(props.connectionId).subscriptionId)

// --- Keyboard cursor --------------------------------------------------------

const listEl = ref<HTMLElement | null>(null)
const cursor = useListCursor(() => subs.value.map((sub) => sub.id))
const activeId = cursor.active
const focused = ref(false)
/** The cursor ring shows only for keyboard use (not after a click). */
const keyboardMode = ref(false)
const activeSub = computed(() => subs.value.find((sub) => sub.id === activeId.value))
const activeDescendant = computed(() =>
  focused.value && activeId.value ? subscriptionDomId(activeId.value) : undefined
)

function rowOf(id: string | null): HTMLElement | null {
  return id ? document.getElementById(subscriptionDomId(id)) : null
}

function onFocus(): void {
  focused.value = true
  keyboardMode.value = listEl.value?.matches(':focus-visible') ?? false
  if (activeId.value === null) cursor.set(filteredId.value ?? subs.value[0]?.id ?? null)
}

function move(to: CursorMove): void {
  cursor.move(to)
  void nextTick(() => rowOf(activeId.value)?.scrollIntoView({ block: 'nearest' }))
}

function withActive(run: (sub: Subscription) => unknown): void {
  const sub = activeSub.value
  if (sub) void run(sub)
}

/** Opens the row menu of the cursor row at its bottom-left corner. */
function openRowMenu(): void {
  const row = rowOf(activeId.value)
  if (!row) return
  const rect = row.getBoundingClientRect()
  row.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 24,
      clientY: rect.bottom - 4
    })
  )
}

async function remove(sub: Subscription): Promise<void> {
  const ids = subs.value.map((other) => other.id)
  const index = ids.indexOf(sub.id)
  const neighbor = ids[index + 1] ?? ids[index - 1] ?? null
  if (!(await actions.remove(sub))) return
  if (activeId.value === null) cursor.set(neighbor)
  // The list (and the focus in it) is gone: start again from the empty state.
  if (subs.value.length === 0) void focusFirst(['[data-testid="subscription-empty-add"]'])
}

const handleKeydown = createListKeydown({
  move,
  activate: () => withActive(actions.toggleFilter),
  toggle: () => withActive((sub) => actions.setEnabled(sub, !sub.enabled)),
  edit: () => withActive(actions.edit),
  copy: () => withActive(actions.copyFilter),
  remove: () => withActive(remove),
  escape: () => actions.clearFilter(),
  contextMenu: openRowMenu
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') keyboardMode.value = true
  handleKeydown(event)
}

function onRowToggle(sub: Subscription): void {
  cursor.set(sub.id)
  actions.toggleFilter(sub)
}

// --- Quick add (empty state) -----------------------------------------------

const quickAdding = ref<string | null>(null)

async function quickAdd(topic: string): Promise<void> {
  if (quickAdding.value !== null) return
  quickAdding.value = topic
  try {
    await actions.quickAdd(topic)
  } finally {
    quickAdding.value = null
  }
}
</script>

<template>
  <section
    data-testid="subscription-panel"
    aria-label="Subscriptions"
    class="flex h-full min-h-0 flex-col bg-panel"
  >
    <PanelHeader title="Subscriptions" :icon="SatelliteDishIcon" :count="subs.length">
      <template #actions>
        <SubscriptionListMenu
          :total="subs.length"
          :enabled="enabledCount"
          @add-multiple="actions.createMany()"
          @copy-all="actions.copyAllFilters()"
          @set-all-enabled="actions.setAllEnabled"
        />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New subscription"
              data-testid="subscription-add"
              @click="actions.create()"
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            New subscription
            <KbdShortcut :keys="SHORTCUTS.newSubscription.keys" :platform="platform" />
          </TooltipContent>
        </Tooltip>
      </template>
    </PanelHeader>

    <div
      v-if="subs.length > 0"
      ref="listEl"
      role="listbox"
      tabindex="0"
      aria-label="Subscriptions"
      :aria-activedescendant="activeDescendant"
      class="@container/list flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5 outline-none scrollbar-slim"
      @focus="onFocus"
      @blur="focused = false"
      @pointerdown="keyboardMode = false"
      @keydown="onKeydown"
    >
      <SubscriptionItem
        v-for="sub in subs"
        :key="sub.id"
        :subscription="sub"
        :profile="profile"
        :live="subscriptions.stateOf(connectionId, sub.id)"
        :connected="connected"
        :mqtt5="mqtt5"
        :filtered="filteredId === sub.id"
        :active="focused && keyboardMode && activeId === sub.id"
        :count="counts.get(sub.id) ?? 0"
        @toggle-filter="onRowToggle(sub)"
        @edit="actions.edit(sub)"
        @duplicate="actions.duplicate(sub)"
        @remove="remove(sub)"
        @copy="actions.copyFilter(sub)"
        @show-topic="actions.showInTopicTree(sub)"
        @set-enabled="(enabled: boolean) => actions.setEnabled(sub, enabled)"
      />
    </div>
    <SubscriptionEmpty v-else :busy="quickAdding" @add="actions.create()" @quick-add="quickAdd" />

    <footer
      v-if="banner"
      class="flex shrink-0 items-start gap-2 border-t px-3 py-2 text-xs leading-snug text-muted-foreground"
    >
      <PlugIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0 text-pretty">{{ banner }}</span>
    </footer>
  </section>
</template>
