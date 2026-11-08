<script setup lang="ts">
/**
 * Active subscription filter (`ui.messageFilter(id).subscriptionId`): the subscription's
 * color, alias or filter, and a button that clears it.
 */
import { computed } from 'vue'
import { XIcon } from '@lucide/vue'
import { IconButton, TopicLabel } from '@/components/common'
import { useSubscriptionsStore, useUiStore } from '@/stores'

const props = defineProps<{ connectionId: string }>()

const ui = useUiStore()
const subscriptions = useSubscriptionsStore()

const subscriptionId = computed(() => ui.messageFilter(props.connectionId).subscriptionId)
const subscription = computed(() =>
  subscriptionId.value ? subscriptions.get(props.connectionId, subscriptionId.value) : undefined
)
const color = computed(() => subscription.value?.color)
const title = computed(() => {
  const sub = subscription.value
  if (!sub) return 'Messages of a removed subscription'
  return `Only messages matching ${sub.topic}${sub.alias ? ` (${sub.alias})` : ''}`
})
const chipStyle = computed(() =>
  color.value
    ? {
        borderColor: `color-mix(in oklab, ${color.value} 45%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color.value} 12%, transparent)`
      }
    : undefined
)

function clear(): void {
  ui.updateMessageFilter(props.connectionId, { subscriptionId: null })
}
</script>

<template>
  <div
    v-if="subscriptionId"
    class="inline-flex h-7 max-w-28 min-w-0 shrink items-center gap-1.5 rounded-md border pr-0.5 pl-2 text-xs animate-in fade-in-0 duration-150 @3xl/toolbar:max-w-48"
    :style="chipStyle"
    :title="title"
  >
    <span
      class="size-2 shrink-0 rounded-full"
      :class="color ? undefined : 'bg-muted-foreground/50'"
      :style="color ? { backgroundColor: color } : undefined"
      aria-hidden="true"
    />
    <span v-if="subscription?.alias" class="min-w-0 truncate font-medium">{{
      subscription.alias
    }}</span>
    <TopicLabel v-else-if="subscription" :topic="subscription.topic" class="min-w-0" />
    <span v-else class="min-w-0 truncate text-muted-foreground italic">Removed</span>
    <IconButton
      label="Clear subscription filter"
      size="icon-xs"
      class="size-5 shrink-0 rounded-[5px]"
      @click="clear"
    >
      <XIcon />
    </IconButton>
  </div>
</template>
