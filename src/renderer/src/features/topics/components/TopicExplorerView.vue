<script setup lang="ts">
/**
 * Topic explorer layout: resizable split of the live tree (left) and the selected topic's
 * detail (right). With no topics at all, one empty state spans the whole panel instead.
 */
import { computed, watch } from 'vue'
import { refDebounced } from '@vueuse/core'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useTopicTreeRows } from '@/composables/useTopicTreeRows'
import { useUiStore } from '@/stores/ui'
import { topicExplorerState } from '../composables/explorer-state'
import { useTreeExpansion } from '../composables/useTreeExpansion'
import TopicDetail from './TopicDetail.vue'
import TopicsEmpty from './TopicsEmpty.vue'
import TopicTree from './TopicTree.vue'

/** Typing pauses this long before the tree is filtered again. */
const SEARCH_DEBOUNCE_MS = 120

const props = defineProps<{ connectionId: string }>()

const ui = useUiStore()
const state = computed(() => topicExplorerState(props.connectionId))
const search = computed({
  get: () => state.value.search.value,
  set: (value: string) => {
    state.value.search.value = value
  }
})
const term = refDebounced(search, SEARCH_DEBOUNCE_MS)

const { rows, topicCount, matchCount } = useTopicTreeRows(
  () => props.connectionId,
  () => state.value.expanded,
  () => term.value
)

// Small trees open themselves (e.g. a few test topics), until the user collapses something.
const expansion = useTreeExpansion(() => props.connectionId)
watch(topicCount, (count) => expansion.autoExpand(count), { immediate: true })

const selected = computed(() => ui.selectedTopic(props.connectionId))
</script>

<template>
  <TopicsEmpty v-if="topicCount === 0" :connection-id="connectionId" />
  <ResizablePanelGroup
    v-else
    direction="horizontal"
    auto-save-id="mqtey:topic-explorer"
    class="min-h-0"
  >
    <ResizablePanel :default-size="40" :min-size="22" class="min-w-0">
      <TopicTree
        :connection-id="connectionId"
        :rows="rows"
        :topic-count="topicCount"
        :match-count="matchCount"
        :search-term="term"
      />
    </ResizablePanel>
    <ResizableHandle />
    <ResizablePanel :default-size="60" :min-size="30" class="min-w-0">
      <TopicDetail :connection-id="connectionId" :topic="selected" />
    </ResizablePanel>
  </ResizablePanelGroup>
</template>
