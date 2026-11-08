<script setup lang="ts">
/**
 * Placeholders of the message panel, each with its primary action: not connected, connecting,
 * no (enabled) subscription, waiting for the first message, filtered to zero, paused.
 *
 * After a failed attempt (status `error`: mostly settings problems such as credentials, TLS or
 * the protocol version) the primary action is "Edit connection" and "Retry" (the header's
 * label) comes second, so the prominent button does not repeat the failing attempt (UX-17).
 * The primary button carries `data-primary-action` (the focus target after a clear).
 */
import { computed } from 'vue'
import {
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlugIcon,
  PlugZapIcon,
  PlusIcon,
  RotateCcwIcon,
  SatelliteDishIcon,
  SearchXIcon,
  SendIcon,
  UnplugIcon
} from '@lucide/vue'
import { EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  useConnectionsStore,
  useMessagesStore,
  useSessionsStore,
  useSubscriptionsStore,
  useUiStore
} from '@/stores'
import { formatCount } from '@/utils/format'
import { usePausedBacklog } from '../composables/usePausedBacklog'
import type { MessageEmptyKind } from '../types'
import ListeningIcon from './ListeningIcon.vue'

const props = defineProps<{
  connectionId: string
  kind: MessageEmptyKind
  /** Messages in memory (for the filtered state). */
  total: number
}>()

const ui = useUiStore()
const sessions = useSessionsStore()
const messages = useMessagesStore()
const connections = useConnectionsStore()
const subscriptions = useSubscriptionsStore()
const backlog = usePausedBacklog(() => props.connectionId)

const name = computed(() => connections.get(props.connectionId)?.name ?? 'the broker')
const session = computed(() => sessions.get(props.connectionId))
const subscriptionCount = computed(() => subscriptions.list(props.connectionId).length)
const enabledCount = computed(
  () => subscriptions.list(props.connectionId).filter((sub) => sub.enabled).length
)

const reconnecting = computed(() => session.value.status === 'reconnecting')
const failed = computed(() => session.value.status === 'error')

const disconnectedText = computed(() =>
  session.value.status === 'error' && session.value.error
    ? `The last attempt failed: ${session.value.error}`
    : `Connect to ${name.value} to start receiving messages.`
)

function subscribeAll(): void {
  ui.openNewSubscription(props.connectionId, { topic: '#' })
}
</script>

<template>
  <div
    data-testid="message-empty-state"
    :data-kind="kind"
    class="flex h-full min-h-0 flex-col overflow-y-auto bg-background"
  >
    <EmptyState
      v-if="kind === 'disconnected'"
      :icon="UnplugIcon"
      :title="failed ? 'Could not connect' : 'Not connected'"
      :description="disconnectedText"
    >
      <template v-if="failed">
        <Button size="sm" data-primary-action @click="ui.openEditConnection(connectionId)">
          <PencilIcon />
          Edit connection
        </Button>
        <Button size="sm" variant="outline" @click="sessions.connect(connectionId)">
          <RotateCcwIcon />
          Retry
        </Button>
      </template>
      <Button v-else size="sm" data-primary-action @click="sessions.connect(connectionId)">
        <PlugIcon />
        Connect
      </Button>
    </EmptyState>

    <EmptyState
      v-else-if="kind === 'connecting'"
      :icon="PlugZapIcon"
      :title="reconnecting ? 'Reconnecting…' : 'Connecting…'"
      :description="
        reconnecting && session.error
          ? `Connection lost: ${session.error}`
          : `Opening a session with ${name}.`
      "
    >
      <Button size="sm" disabled>
        <Spinner />
        {{ reconnecting ? 'Reconnecting' : 'Connecting' }}
      </Button>
      <Button size="sm" variant="outline" @click="sessions.disconnect(connectionId)">
        Cancel
      </Button>
    </EmptyState>

    <EmptyState
      v-else-if="kind === 'no-subscriptions'"
      :icon="SatelliteDishIcon"
      :title="
        subscriptionCount === 0
          ? 'Subscribe to a topic to see messages'
          : 'All subscriptions are disabled'
      "
      :description="
        subscriptionCount === 0
          ? 'Start with # to receive everything on the broker, then narrow it down.'
          : 'Enable a subscription in the panel on the left, or add a new one.'
      "
    >
      <Button size="sm" data-primary-action @click="subscribeAll">
        <PlusIcon />
        {{ subscriptionCount === 0 ? 'Subscribe to #' : 'Add subscription' }}
      </Button>
    </EmptyState>

    <EmptyState
      v-else-if="kind === 'waiting'"
      :icon="ListeningIcon"
      title="Waiting for messages…"
      :description="`Listening on ${formatCount(enabledCount, 'subscription')}. Messages appear here as they arrive.`"
    >
      <Button
        size="sm"
        variant="outline"
        data-primary-action
        @click="ui.requestPublishFocus(connectionId)"
      >
        <SendIcon />
        Publish a message
      </Button>
    </EmptyState>

    <EmptyState
      v-else-if="kind === 'filtered'"
      :icon="SearchXIcon"
      title="No messages match your filters"
      :description="`${formatCount(total, 'message')} in memory, none of them match.`"
    >
      <Button size="sm" data-primary-action @click="ui.resetMessageFilter(connectionId)">
        <RotateCcwIcon />
        Reset filters
      </Button>
    </EmptyState>

    <EmptyState
      v-else
      :icon="PauseIcon"
      title="Paused"
      :description="`${formatCount(backlog, 'message')} arrived while paused.`"
    >
      <Button size="sm" data-primary-action @click="messages.setPaused(connectionId, false)">
        <PlayIcon />
        Resume
      </Button>
    </EmptyState>
  </div>
</template>
