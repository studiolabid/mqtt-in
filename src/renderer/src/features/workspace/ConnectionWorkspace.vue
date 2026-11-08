<script setup lang="ts">
/**
 * Workspace of one connection (route `/connections/:id`): header, subscriptions on the left,
 * Messages / Topics / Logs on the right above the publisher, which collapses to its header.
 * Panel sizes are remembered in pixels (independent of the window size); the publisher is fitted
 * to short windows and high zoom (`usePublisherLayout`).
 */
import { computed, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import { SplitterPanel } from 'reka-ui'
import { useElementSize } from '@vueuse/core'
import { HouseIcon, UnplugIcon } from '@lucide/vue'
import { EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useNavigation } from '@/composables'
import PublishPanel from '@/features/publish/PublishPanel.vue'
import SubscriptionPanel from '@/features/subscriptions/SubscriptionPanel.vue'
import { useConnectionsStore, useUiStore } from '@/stores'
import WorkspaceHeader from './components/WorkspaceHeader.vue'
import WorkspaceTabs from './components/WorkspaceTabs.vue'
import { usePublisherLayout } from './composables/usePublisherLayout'
import {
  PUBLISH_HEIGHT,
  SUBSCRIPTIONS_WIDTH,
  rememberWorkspaceLayout,
  workspaceLayout
} from './utils/layout'

const props = defineProps<{ id: string }>()

const connections = useConnectionsStore()
const ui = useUiStore()
const nav = useNavigation()

const profile = computed(() => connections.get(props.id))

const publishPanel = ref<InstanceType<typeof SplitterPanel> | null>(null)
const publishGroup = ref<ComponentPublicInstance | null>(null)
const subscriptionsPanel = ref<InstanceType<typeof SplitterPanel> | null>(null)
const columns = ref<ComponentPublicInstance | null>(null)

const {
  defaultSize: publishDefaultSize,
  collapsed: publishCollapsed,
  toggle: togglePublish,
  onHandleDragging,
  onHandleKeyup
} = usePublisherLayout({
  panel: publishPanel,
  group: publishGroup,
  // "Edit & publish" (and friends) bump this counter: reveal the publisher.
  revealRequest: () => ui.publishFocusRequest(props.id)
})

// --- Subscription column width ---------------------------------------------
// Remembered at the end of a resize gesture only: a narrow window or a high zoom squeezes the
// column, which must not overwrite the user's width. It grows back once there is room again.

let subscriptionsWidth = workspaceLayout().subscriptionsWidth

function commitSubscriptionsWidth(): void {
  const size = subscriptionsPanel.value?.getSize()
  if (size === undefined || !Number.isFinite(size)) return
  subscriptionsWidth = Math.round(size)
  rememberWorkspaceLayout({ subscriptionsWidth })
}

function onSubscriptionsKeyup(event: KeyboardEvent): void {
  if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
    commitSubscriptionsWidth()
  }
}

const { width: columnsWidth } = useElementSize(columns)
let widthFrame = 0
watch(columnsWidth, () => {
  cancelAnimationFrame(widthFrame)
  // A frame later, so reka-ui has applied the new group size to its layout first.
  widthFrame = requestAnimationFrame(() => {
    const panel = subscriptionsPanel.value
    // reka-ui clamps the size to what the other column leaves.
    if (panel && panel.getSize() < subscriptionsWidth - 1) panel.resize(subscriptionsWidth)
  })
})
onBeforeUnmount(() => cancelAnimationFrame(widthFrame))
</script>

<template>
  <div v-if="profile" data-testid="workspace" class="flex h-full min-h-0 flex-col">
    <WorkspaceHeader :profile="profile" />
    <ResizablePanelGroup ref="columns" direction="horizontal" class="min-h-0 flex-1">
      <SplitterPanel
        ref="subscriptionsPanel"
        data-slot="resizable-panel"
        size-unit="px"
        :default-size="subscriptionsWidth"
        :min-size="SUBSCRIPTIONS_WIDTH.min"
        :max-size="SUBSCRIPTIONS_WIDTH.max"
        class="min-w-0"
      >
        <SubscriptionPanel :connection-id="id" />
      </SplitterPanel>
      <ResizableHandle
        aria-label="Resize subscriptions"
        @dragging="(dragging: boolean) => dragging || commitSubscriptionsWidth()"
        @keyup="onSubscriptionsKeyup"
      />
      <ResizablePanel :min-size="40" class="min-w-0">
        <ResizablePanelGroup ref="publishGroup" direction="vertical">
          <ResizablePanel :min-size="30" class="min-h-0">
            <WorkspaceTabs
              :connection-id="id"
              :publish-collapsed="publishCollapsed"
              @toggle-publish="togglePublish"
            />
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize the publisher (Enter collapses or expands it)"
            title="Drag to resize · double-click to collapse or expand"
            @dblclick="togglePublish"
            @keydown.enter.prevent="togglePublish"
            @keyup="onHandleKeyup"
            @dragging="onHandleDragging"
          />
          <SplitterPanel
            id="workspace-publisher"
            ref="publishPanel"
            data-slot="resizable-panel"
            data-testid="publisher-panel"
            size-unit="px"
            collapsible
            :collapsed-size="PUBLISH_HEIGHT.collapsed"
            :min-size="PUBLISH_HEIGHT.min"
            :default-size="publishDefaultSize"
            class="min-h-0"
          >
            <div class="h-full min-h-0 overflow-hidden">
              <PublishPanel :connection-id="id" />
            </div>
          </SplitterPanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>

  <div v-else class="flex h-full min-h-0 items-center justify-center">
    <EmptyState
      :icon="UnplugIcon"
      title="Connection not found"
      description="It may have been deleted. Pick another connection in the sidebar."
    >
      <Button @click="nav.openWelcome()">
        <HouseIcon data-icon="inline-start" />
        Back to home
      </Button>
    </EmptyState>
  </div>
</template>
