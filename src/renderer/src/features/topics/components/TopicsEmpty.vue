<script setup lang="ts">
/**
 * Empty topic explorer: explains what is missing for topics to show up (a connection, a
 * subscription or simply the first message) and offers the matching next step.
 */
import { computed, ref } from 'vue'
import { BellPlusIcon, NetworkIcon, PlugIcon, SendHorizontalIcon } from '@lucide/vue'
import { EmptyState, KbdShortcut } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useConnectionsStore } from '@/stores/connections'
import { useSessionsStore } from '@/stores/sessions'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { useUiStore } from '@/stores/ui'
import { SHORTCUTS } from '@/utils/shortcuts'

const props = defineProps<{ connectionId: string }>()

const connections = useConnectionsStore()
const sessions = useSessionsStore()
const subscriptions = useSubscriptionsStore()
const ui = useUiStore()

const starting = ref(false)
const session = computed(() => sessions.get(props.connectionId))
const name = computed(() => connections.get(props.connectionId)?.name ?? 'the broker')
const subscribed = computed(() =>
  subscriptions.list(props.connectionId).some((subscription) => subscription.enabled)
)

type Mode = 'offline' | 'connecting' | 'unsubscribed' | 'waiting'

const mode = computed<Mode>(() => {
  const status = session.value.status
  if (status === 'connected') return subscribed.value ? 'waiting' : 'unsubscribed'
  if (status === 'connecting' || status === 'reconnecting') return 'connecting'
  return 'offline'
})

const copy = computed(() => {
  switch (mode.value) {
    case 'connecting':
      return {
        title: 'Connecting…',
        description: 'Topics appear here, live, as soon as the first message arrives.'
      }
    case 'unsubscribed':
      return {
        title: 'Nothing subscribed yet',
        description:
          'Add a subscription to start receiving messages. The filter # receives every topic.'
      }
    case 'waiting':
      return {
        title: 'Waiting for messages',
        description: 'Topics appear here as soon as a message arrives on one of your subscriptions.'
      }
    default:
      return {
        title: 'No topics yet',
        description:
          session.value.status === 'error' && session.value.error
            ? `The last attempt failed: ${session.value.error}`
            : `Connect to ${name.value} and the topic tree builds itself from live messages.`
      }
  }
})

async function connect(): Promise<void> {
  starting.value = true
  try {
    await sessions.connect(props.connectionId)
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div
    data-testid="topic-empty"
    class="flex h-full min-h-0 items-center justify-center overflow-y-auto"
  >
    <EmptyState
      :icon="NetworkIcon"
      :title="copy.title"
      :description="copy.description"
      class="max-w-md"
    >
      <template v-if="mode === 'offline'">
        <Button :disabled="starting" @click="connect">
          <Spinner v-if="starting" />
          <PlugIcon v-else aria-hidden="true" />
          {{ session.status === 'error' ? 'Retry' : 'Connect' }}
        </Button>
      </template>
      <Spinner v-else-if="mode === 'connecting'" class="text-muted-foreground" />
      <template v-else>
        <Button
          v-if="mode === 'waiting'"
          variant="outline"
          @click="ui.requestPublishFocus(connectionId)"
        >
          <SendHorizontalIcon aria-hidden="true" />
          Publish a message
        </Button>
        <Button
          :variant="mode === 'unsubscribed' ? 'default' : 'outline'"
          @click="ui.openNewSubscription(connectionId)"
        >
          <BellPlusIcon aria-hidden="true" />
          Add subscription
        </Button>
        <p
          class="flex basis-full items-center justify-center gap-1.5 pt-1 text-xs text-muted-foreground"
        >
          <KbdShortcut :keys="SHORTCUTS.newSubscription.keys" />
          adds a subscription from anywhere
        </p>
      </template>
    </EmptyState>
  </div>
</template>
