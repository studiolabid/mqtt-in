<script setup lang="ts">
/**
 * Topic detail header: the topic as a breadcrumb, its counts, last update, retained and
 * subscription badges, and the topic actions (copy, pin the value to the top, publish, filter
 * messages, subscribe, clear retained).
 *
 * "Clear retained message" is offered for any topic whose last message has a payload: live
 * deliveries usually arrive without the retain flag, so the broker may keep one even when the
 * Retained badge is missing (PRODUCT-03); the confirm says which case applies.
 */
import { computed } from 'vue'
import {
  BellPlusIcon,
  BookmarkIcon,
  CopyIcon,
  ListFilterIcon,
  PinIcon,
  PinOffIcon,
  SendHorizontalIcon
} from '@lucide/vue'
import { RelativeTime } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFormatters } from '@/composables/useFormatters'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { useUiStore } from '@/stores/ui'
import type { TopicNodeSnapshot } from '@/utils/topic-tree'
import { cn } from '@/lib/utils'
import { pinFieldOf, usePinToggle } from '../composables/usePinnedSeries'
import { useTopicActions } from '../composables/useTopicActions'
import TopicBreadcrumb from './TopicBreadcrumb.vue'

const props = defineProps<{
  connectionId: string
  topic: string
  /** `undefined` = no message received on this topic (yet). */
  node?: TopicNodeSnapshot
}>()

const ui = useUiStore()
const subscriptions = useSubscriptionsStore()
const fmt = useFormatters()
const actions = useTopicActions(() => props.connectionId)

const branch = computed(() => (props.node?.childCount ?? 0) > 0)
const subscription = computed(() =>
  subscriptions.subscriptionForTopic(props.connectionId, props.topic)
)
const clearing = computed(() => actions.isClearing(props.topic))
const hasPayload = computed(() => (props.node?.lastMessage?.payload.length ?? 0) > 0)

const pins = usePinToggle(() => props.connectionId)
const pinField = computed(() => pinFieldOf(props.node?.lastMessage))
const pinned = computed(() => pinField.value !== null && pins.isPinned(props.topic, pinField.value))

function togglePin(): void {
  if (pinField.value !== null) pins.toggle(props.topic, pinField.value)
}

function count(n: number, word: string): string {
  return `${fmt.number(n)} ${n === 1 ? word : `${word}s`}`
}

const summary = computed(() => {
  const node = props.node
  if (!node) return 'No messages received on this topic'
  if (node.childCount === 0) return count(node.messageCount, 'message')
  if (node.messageCount === 0) {
    return `${count(node.topicCount, 'topic')} · ${count(node.totalMessages, 'message')}`
  }
  return `${count(node.messageCount, 'message')} · ${count(node.topicCount - 1, 'topic')} below`
})

const filterLabel = computed(() =>
  branch.value ? 'Filter messages on this branch' : 'Filter messages on this topic'
)
const subscribeLabel = computed(() => (branch.value ? 'Subscribe to this branch…' : 'Subscribe…'))
</script>

<template>
  <header class="shrink-0 border-b pt-2.5 pr-2 pb-2 pl-3">
    <div class="flex items-start gap-2">
      <TopicBreadcrumb
        :topic="topic"
        class="min-w-0 flex-1 pt-0.5"
        @select="(ancestor: string) => ui.selectTopic(connectionId, ancestor)"
      />
      <div class="-mt-0.5 flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground"
              aria-label="Copy topic"
              @click="actions.copyTopic(topic)"
            >
              <CopyIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy topic</TooltipContent>
        </Tooltip>
        <Tooltip v-if="pinField !== null">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="topic-pin"
              data-pin-source="header"
              :data-field="pinField"
              :class="cn('text-muted-foreground', pinned && 'text-foreground')"
              :aria-pressed="pinned"
              :aria-label="pinned ? 'Unpin' : 'Pin to the top'"
              @click="togglePin"
            >
              <BookmarkIcon :class="cn(pinned && 'fill-current')" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ pinned ? 'Unpin' : 'Pin to the top' }}</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" class="mx-1 h-4 self-center" />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground"
              aria-label="Publish to topic"
              @click="actions.publishTo(topic)"
            >
              <SendHorizontalIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Publish to topic</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground"
              :aria-label="filterLabel"
              @click="actions.filterMessages(topic, branch)"
            >
              <ListFilterIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ filterLabel }}</TooltipContent>
        </Tooltip>
        <Tooltip v-if="actions.mqtt.value">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground"
              :aria-label="subscribeLabel"
              @click="actions.subscribe(topic, branch)"
            >
              <BellPlusIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ subscribeLabel }}</TooltipContent>
        </Tooltip>
        <Tooltip v-if="hasPayload && actions.mqtt.value">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="topic-clear-retained"
              class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
              aria-label="Clear retained message"
              :disabled="clearing || !actions.connected.value"
              @click="actions.clearRetained(topic, { known: node?.retained === true })"
            >
              <Spinner v-if="clearing" />
              <PinOffIcon v-else aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear retained message</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <div
      class="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
    >
      <span class="tabular-nums">{{ summary }}</span>
      <span v-if="node && node.updatedAt > 0" class="inline-flex items-center gap-1">
        updated
        <RelativeTime :timestamp="node.updatedAt" class="text-foreground/90" />
      </span>
      <span
        v-if="node?.retained"
        class="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] text-foreground/80"
        title="The broker keeps a retained message for this topic"
      >
        <PinIcon class="size-3" aria-hidden="true" />
        Retained
      </span>
      <span
        v-if="subscription"
        class="inline-flex min-w-0 items-center gap-1.5"
        :title="`Received through the subscription ${subscription.topic}`"
      >
        <span
          class="size-2 shrink-0 rounded-full"
          :style="{ backgroundColor: subscription.color }"
          aria-hidden="true"
        />
        <span class="truncate font-mono">{{ subscription.alias || subscription.topic }}</span>
      </span>
    </div>
  </header>
</template>
