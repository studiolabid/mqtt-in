<script setup lang="ts">
/**
 * Connections sidebar (fills the sidebar column of the app shell, which draws its border):
 * header actions (new, import, more), search and the grouped list. The session counts live in
 * the status bar only (one home per number, UX-14). On first run the empty state stays minimal
 * while the welcome screen shows the entry points (UX-15). Import and export show the store's
 * busy state, shared by every entry point (palette, welcome, Settings > Data; RC-22).
 */
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  EllipsisIcon,
  FileDownIcon,
  FileUpIcon,
  PlusIcon,
  UnplugIcon
} from '@lucide/vue'
import { KbdShortcut, PanelHeader, SearchInput } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hostPlatform } from '@/composables/useHotkey'
import { ROUTE_NAMES } from '@/composables/useNavigation'
import { useConnectionsStore } from '@/stores/connections'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import { SHORTCUTS } from '@/utils/shortcuts'
import ConnectionList from './components/sidebar/ConnectionList.vue'
import SidebarEmpty from './components/sidebar/SidebarEmpty.vue'
import { useCollapsedGroups } from './composables/useCollapsedGroups'

const connections = useConnectionsStore()
const sessions = useSessionsStore()
const ui = useUiStore()
const platform = hostPlatform()
const collapsed = useCollapsedGroups()
const route = useRoute()
/** The welcome screen shows the entry points (new, import, presets): the empty state stays short. */
const onWelcome = computed(() => route.name === ROUTE_NAMES.welcome)

const query = ref('')
const list = ref<InstanceType<typeof ConnectionList> | null>(null)

const total = computed(() => connections.profiles.length)
const groupNames = computed(() => connections.groupNames)
const allCollapsed = computed(
  () => groupNames.value.length > 0 && groupNames.value.every((name) => collapsed.isCollapsed(name))
)
const activeIds = computed(() =>
  connections.profiles.map((profile) => profile.id).filter((id) => sessions.isActive(id))
)

function toggleAllGroups(): void {
  if (allCollapsed.value) collapsed.expandAll()
  else collapsed.collapseAll(groupNames.value)
}

async function disconnectAll(): Promise<void> {
  await Promise.all(activeIds.value.map((id) => sessions.disconnect(id)))
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    list.value?.focusFirst()
  } else if (event.key === 'Enter' && !event.isComposing) {
    if (list.value?.openFirst()) event.preventDefault()
  }
}
</script>

<template>
  <aside
    data-testid="sidebar"
    aria-label="Connections"
    class="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
  >
    <PanelHeader title="Connections" :count="total > 0 ? total : undefined" class="pr-2 pl-4">
      <template #actions>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="sidebar-new-connection"
              aria-label="New connection"
              @click="ui.openNewConnection()"
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            New connection
            <KbdShortcut :keys="SHORTCUTS.newConnection.keys" :platform="platform" />
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Import connections"
              data-testid="sidebar-import"
              :disabled="connections.importing"
              :aria-busy="connections.importing || undefined"
              @click="connections.importFromFile()"
            >
              <Spinner v-if="connections.importing" class="size-3.5" />
              <FileUpIcon v-else aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Import connections…</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger as-child>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <EllipsisIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>More actions</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" class="w-52">
            <DropdownMenuItem
              data-testid="sidebar-export-all"
              :disabled="total === 0 || connections.exporting"
              @select="connections.exportToFile()"
            >
              <FileDownIcon aria-hidden="true" />
              Export all…
            </DropdownMenuItem>
            <DropdownMenuItem :disabled="activeIds.length === 0" @select="disconnectAll">
              <UnplugIcon aria-hidden="true" />
              Disconnect all
            </DropdownMenuItem>
            <template v-if="groupNames.length > 0">
              <DropdownMenuSeparator />
              <DropdownMenuItem @select="toggleAllGroups">
                <ChevronsUpDownIcon v-if="allCollapsed" aria-hidden="true" />
                <ChevronsDownUpIcon v-else aria-hidden="true" />
                {{ allCollapsed ? 'Expand all groups' : 'Collapse all groups' }}
              </DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
    </PanelHeader>

    <div
      v-if="!connections.loaded"
      class="flex flex-col gap-0.5 p-2"
      aria-busy="true"
      aria-label="Loading connections"
    >
      <div v-for="row in 3" :key="row" class="flex items-center gap-2.5 px-2 py-1.5">
        <Skeleton class="size-8 rounded-lg" />
        <div class="flex flex-1 flex-col gap-1.5">
          <Skeleton class="h-3 w-24" />
          <Skeleton class="h-2.5 w-36" />
        </div>
      </div>
    </div>

    <SidebarEmpty v-else-if="total === 0" :minimal="onWelcome" />

    <template v-else>
      <div class="px-2 pt-2 pb-1">
        <SearchInput
          v-model="query"
          data-testid="sidebar-search"
          size="sm"
          placeholder="Search connections…"
          @keydown="onSearchKeydown"
        />
      </div>
      <ConnectionList
        ref="list"
        :query="query"
        :collapsed="collapsed"
        class="min-h-0 flex-1"
        @clear-search="query = ''"
      />
    </template>
  </aside>
</template>
