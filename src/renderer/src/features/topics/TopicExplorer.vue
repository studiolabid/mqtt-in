<script setup lang="ts">
/**
 * Topics tab of the connection workspace: live topic tree + topic detail (value, history with
 * diff, numeric charts).
 *
 * The workspace keeps every tab mounted (`v-show`); the explorer's content is only mounted
 * while the Topics tab is shown, so no tree flattening or chart work runs in the background.
 * Its view state (expanded nodes, search, scroll, tabs) lives per connection and survives.
 */
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import TopicExplorerView from './components/TopicExplorerView.vue'

const props = defineProps<{ connectionId: string }>()

const ui = useUiStore()
const active = computed(() => ui.workspaceTab(props.connectionId) === 'topics')
</script>

<template>
  <div
    data-testid="topic-explorer"
    class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background"
  >
    <TopicExplorerView
      v-if="active"
      :key="connectionId"
      :connection-id="connectionId"
      class="min-h-0 flex-1"
    />
  </div>
</template>
