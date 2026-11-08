<script setup lang="ts">
/**
 * Summary of a branch: totals below it and its direct children — most recently active or
 * busiest first — with each child's share of the traffic. Clicking a child selects it.
 * With known-retained topics below, "Clear retained below… (N)" clears them all at once
 * (FP-1; a destructive action that needs a connection).
 */
import { computed, ref } from 'vue'
import { ChevronRightIcon, PinIcon, PinOffIcon } from '@lucide/vue'
import { RelativeTime } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useFormatters } from '@/composables/useFormatters'
import { previewOf } from '@/composables/usePayloadPreview'
import { cn } from '@/lib/utils'
import { useMessagesStore } from '@/stores/messages'
import { useUiStore } from '@/stores/ui'
import type { TopicNodeSnapshot } from '@/utils/topic-tree'
import { useLiveValue } from '../composables/useLiveValue'
import { useTopicActions } from '../composables/useTopicActions'
import { useTopicChildren, type ChildSort } from '../composables/useTopicData'

const PREVIEW_CHARS = 120

const props = defineProps<{
  connectionId: string
  node: TopicNodeSnapshot
}>()

const ui = useUiStore()
const messages = useMessagesStore()
const actions = useTopicActions(() => props.connectionId)
const fmt = useFormatters()
/** Known-retained topics below the branch (re-read with the other live data). */
const retainedCount = useLiveValue(
  () => props.connectionId,
  () => messages.retainedBelow(props.connectionId, props.node.topic).length,
  { key: () => props.node.topic }
)
const clearingBelow = computed(() => actions.isClearingBelow(props.node.topic))
const sort = ref<ChildSort>('recent')
const children = useTopicChildren(
  () => props.connectionId,
  () => props.node.topic,
  () => sort.value
)
const format = computed(() => ui.viewFormat(props.connectionId))

const tiles = computed(() => [
  { label: 'Topics', value: props.node.topicCount },
  { label: 'Messages', value: props.node.totalMessages },
  { label: 'Subtopics', value: props.node.childCount }
])

/** Width of a child's traffic bar, relative to the busiest child. */
function share(total: number): string {
  const max = children.value.maxMessages
  return max > 0 ? `${Math.max(3, Math.round((total / max) * 100))}%` : '0%'
}

function onSort(value: unknown): void {
  if (value === 'recent' || value === 'busiest') sort.value = value
}
</script>

<template>
  <div class="@container/summary flex h-full min-h-0 flex-col overflow-y-auto scrollbar-slim">
    <dl class="grid shrink-0 grid-cols-2 gap-2 p-3 @lg/summary:grid-cols-4">
      <div v-for="tile in tiles" :key="tile.label" class="rounded-lg border bg-card px-3 py-2">
        <dt class="text-xs text-muted-foreground">{{ tile.label }}</dt>
        <dd class="mt-0.5 text-lg font-semibold" :title="fmt.number(tile.value)">
          {{ fmt.compact(tile.value) }}
        </dd>
      </div>
      <div class="rounded-lg border bg-card px-3 py-2">
        <dt class="text-xs text-muted-foreground">Last activity</dt>
        <dd class="mt-0.5 truncate text-lg font-semibold">
          <RelativeTime :timestamp="node.updatedAt" />
        </dd>
      </div>
    </dl>

    <div v-if="retainedCount > 0" class="flex shrink-0 items-center gap-2 px-3 pb-2">
      <Button
        data-testid="topic-summary-clear-retained-below"
        size="sm"
        variant="outline"
        class="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
        :disabled="!actions.connected.value || clearingBelow"
        @click="actions.clearRetainedBelow(node.topic)"
      >
        <Spinner v-if="clearingBelow" />
        <PinOffIcon v-else aria-hidden="true" />
        Clear retained below… ({{ fmt.number(retainedCount) }})
      </Button>
      <span v-if="!actions.connected.value" class="text-xs text-muted-foreground">
        Connect to clear them.
      </span>
    </div>

    <div class="flex h-9 shrink-0 items-center justify-between gap-2 px-3">
      <h3 class="text-xs font-medium text-muted-foreground">
        Subtopics
        <span class="ml-1 font-mono tabular-nums">{{ fmt.number(children.total) }}</span>
      </h3>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        :model-value="sort"
        aria-label="Sort subtopics"
        @update:model-value="onSort"
      >
        <ToggleGroupItem value="recent" class="h-6 min-w-0 px-2 text-xs">Recent</ToggleGroupItem>
        <ToggleGroupItem value="busiest" class="h-6 min-w-0 px-2 text-xs">Busiest</ToggleGroupItem>
      </ToggleGroup>
    </div>

    <ul class="px-1.5 pb-2" aria-label="Subtopics">
      <li v-for="child in children.items" :key="child.topic">
        <button
          type="button"
          :title="child.topic"
          class="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-[13px] outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-muted/50"
          @click="ui.selectTopic(connectionId, child.topic)"
        >
          <ChevronRightIcon
            v-if="child.hasChildren"
            class="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span
            v-else
            class="flex size-3.5 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            <span class="size-1 rounded-full bg-muted-foreground/45" />
          </span>
          <span
            :class="
              cn(
                'min-w-0 truncate font-mono',
                child.hasChildren ? 'font-medium' : 'text-foreground/90',
                child.lastMessage && 'max-w-[45%] shrink-0'
              )
            "
          >
            <template v-if="child.name">{{ child.name }}</template>
            <span v-else class="text-muted-foreground italic">(empty)</span>
          </span>
          <PinIcon
            v-if="child.retained"
            class="size-3 shrink-0 text-muted-foreground"
            aria-label="retained"
          />
          <span
            v-if="child.lastMessage"
            class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          >
            <span aria-hidden="true">= </span>
            {{ previewOf(child.lastMessage, format, PREVIEW_CHARS) }}
          </span>
          <span v-else class="flex-1" />
          <span
            class="hidden h-1 w-14 shrink-0 overflow-hidden rounded-full bg-muted @sm/summary:block"
            aria-hidden="true"
          >
            <span
              class="block h-full rounded-full bg-primary/70"
              :style="{ width: share(child.totalMessages) }"
            />
          </span>
          <span
            class="w-11 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums"
            :title="`${fmt.number(child.totalMessages)} messages`"
          >
            {{ fmt.compact(child.totalMessages) }}
          </span>
          <RelativeTime
            :timestamp="child.updatedAt"
            class="hidden w-16 shrink-0 text-right text-xs text-muted-foreground @md/summary:block"
          />
        </button>
      </li>
    </ul>
    <p
      v-if="children.total > children.items.length"
      class="px-3 pb-3 text-xs text-muted-foreground"
    >
      Showing the first {{ children.items.length }} of {{ fmt.number(children.total) }} subtopics.
    </p>
  </div>
</template>
