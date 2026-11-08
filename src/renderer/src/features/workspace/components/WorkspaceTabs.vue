<script setup lang="ts">
/**
 * Tab bar (Messages / Topics / Logs with live badges) and the three views, kept mounted (hidden
 * when inactive) so switching is instant and each keeps its scroll position. The bar also holds
 * the publisher toggle (`toggle-publisher`: "Collapse publisher" / "Show publisher").
 *
 * The tab tooltips (with the Mod+1/2/3 hint) sit on the tab triggers themselves, so they also
 * show on keyboard focus; the triggers announce their shortcut with `aria-keyshortcuts`.
 */
import { computed, type Component } from 'vue'
import {
  ListTreeIcon,
  MessagesSquareIcon,
  PanelBottomCloseIcon,
  PanelBottomOpenIcon,
  ScrollTextIcon
} from '@lucide/vue'
import { isMacPlatform, KbdShortcut } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hostPlatform, useThrottledValue } from '@/composables'
import LogPanel from '@/features/logs/LogPanel.vue'
import MessagePanel from '@/features/messages/MessagePanel.vue'
import TopicExplorer from '@/features/topics/TopicExplorer.vue'
import { useLogsStore, useMessagesStore, useUiStore } from '@/stores'
import type { WorkspaceTab } from '@/types'
import { formatCompact, formatNumber } from '@/utils/format'
import { SHORTCUTS } from '@/utils/shortcuts'

const props = defineProps<{
  connectionId: string
  publishCollapsed: boolean
}>()

const emit = defineEmits<{ togglePublish: [] }>()

interface TabItem {
  value: WorkspaceTab
  label: string
  icon: Component
  keys: readonly string[]
}

const TABS: readonly TabItem[] = [
  {
    value: 'messages',
    label: 'Messages',
    icon: MessagesSquareIcon,
    keys: SHORTCUTS.tabMessages.keys
  },
  { value: 'topics', label: 'Topics', icon: ListTreeIcon, keys: SHORTCUTS.tabTopics.keys },
  { value: 'logs', label: 'Logs', icon: ScrollTextIcon, keys: SHORTCUTS.tabLogs.keys }
]

/** A line tab: written with the base trigger's variants, so `cn` replaces its values. */
const TRIGGER_CLASS =
  'group/trigger h-full flex-none gap-1.5 px-2.5 text-[13px] text-muted-foreground hover:text-foreground data-active:text-foreground [&_svg:not([class*=size-])]:size-3.5 after:rounded-full after:bg-primary group-data-horizontal/tabs:after:inset-x-1.5 group-data-horizontal/tabs:after:-bottom-px'

const ui = useUiStore()
const messages = useMessagesStore()
const logs = useLogsStore()
const platform = hostPlatform()
const mac = isMacPlatform(platform)

const tab = computed(() => ui.workspaceTab(props.connectionId))
const messageCount = useThrottledValue(() => messages.count(props.connectionId), 250)
const topicCount = useThrottledValue(() => messages.topicTree(props.connectionId).topicCount, 500)
const errorCount = computed(() => logs.counts(props.connectionId).error)

const publishLabel = computed(() =>
  props.publishCollapsed ? 'Show publisher' : 'Collapse publisher'
)

/** `aria-keyshortcuts` of registry keys (`['Mod', '1']` → `Control+1`, `Meta+1` on macOS). */
function ariaKeys(keys: readonly string[]): string {
  return keys.map((key) => (key === 'Mod' ? (mac ? 'Meta' : 'Control') : key)).join('+')
}

function badgeOf(value: WorkspaceTab): number {
  if (value === 'messages') return messageCount.value
  if (value === 'topics') return topicCount.value
  return errorCount.value
}

function badgeTitle(value: WorkspaceTab, count: number): string {
  if (value === 'messages') return `${formatNumber(count)} messages in memory`
  if (value === 'topics') return `${formatNumber(count)} topics`
  return `${formatNumber(count)} errors`
}

function isTab(value: unknown): value is WorkspaceTab {
  return value === 'messages' || value === 'topics' || value === 'logs'
}

function onTabChange(value: string | number): void {
  if (isTab(value)) ui.setWorkspaceTab(props.connectionId, value)
}
</script>

<template>
  <Tabs
    :model-value="tab"
    :unmount-on-hide="false"
    class="h-full min-h-0 flex-col gap-0"
    @update:model-value="onTabChange"
  >
    <div class="flex h-10 shrink-0 items-center gap-2 border-b pr-2 pl-1.5">
      <TabsList variant="line" aria-label="Workspace views" class="h-full gap-0.5 p-0">
        <Tooltip v-for="item in TABS" :key="item.value">
          <TooltipTrigger as-child>
            <TabsTrigger
              :value="item.value"
              :data-testid="`workspace-tab-${item.value}`"
              :aria-keyshortcuts="ariaKeys(item.keys)"
              :class="TRIGGER_CLASS"
            >
              <component :is="item.icon" aria-hidden="true" />
              {{ item.label }}
              <span
                v-if="badgeOf(item.value) > 0"
                :title="badgeTitle(item.value, badgeOf(item.value))"
                class="min-w-[18px] rounded-full px-1.5 text-center font-mono text-[10px] leading-4 font-medium tabular-nums transition-colors"
                :class="
                  item.value === 'logs'
                    ? 'bg-destructive/12 text-destructive'
                    : 'bg-muted text-muted-foreground group-data-active/trigger:bg-primary/12 group-data-active/trigger:text-primary-text'
                "
              >
                {{ formatCompact(badgeOf(item.value)) }}
              </span>
            </TabsTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Show {{ item.label.toLowerCase() }}
            <KbdShortcut :keys="item.keys" :platform="platform" />
          </TooltipContent>
        </Tooltip>
      </TabsList>

      <div class="ml-auto flex items-center">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground"
              data-testid="toggle-publisher"
              aria-controls="workspace-publisher"
              :aria-expanded="!publishCollapsed"
              :aria-label="publishLabel"
              @click="emit('togglePublish')"
            >
              <PanelBottomOpenIcon v-if="publishCollapsed" />
              <PanelBottomCloseIcon v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">{{ publishLabel }}</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <TabsContent
      value="messages"
      class="relative min-h-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <MessagePanel :connection-id="connectionId" />
    </TabsContent>
    <TabsContent
      value="topics"
      class="relative min-h-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <TopicExplorer :connection-id="connectionId" />
    </TabsContent>
    <TabsContent
      value="logs"
      class="relative min-h-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <LogPanel :connection-id="connectionId" />
    </TabsContent>
  </Tabs>
</template>
