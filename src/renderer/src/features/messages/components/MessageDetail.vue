<script setup lang="ts">
/**
 * Detail of the selected message (right of the list), payload first (UX-03): the topic and the
 * subscription that delivered it, one summary line (time · size · QoS · format, with chips for
 * the flags that are set), the payload / diff, then the collapsed "Details" (full metadata and
 * MQTT 5 properties); the publish actions sit in the footer. Esc (focus inside) closes it.
 * The message may have been evicted from the ring buffer meanwhile: that is shown explicitly.
 */
import { computed, ref, useId } from 'vue'
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BracesIcon,
  EllipsisIcon,
  GhostIcon,
  HashIcon,
  ListFilterIcon,
  ListTreeIcon,
  RepeatIcon,
  SquarePenIcon,
  TerminalIcon,
  XIcon
} from '@lucide/vue'
import { isMqttProfile } from '@shared/connection-kind'
import { EmptyState, IconButton, TopicLabel } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useConnectionsStore, useMessagesStore, useSubscriptionsStore } from '@/stores'
import { isEditableTarget } from '@/utils/hotkey'
import { SHORTCUTS } from '@/utils/shortcuts'
import { useCopyCommand } from '../composables/useCopyCommand'
import { useMessageActions } from '../composables/useMessageActions'
import { DIRECTION_LABELS, messageSummary, type MessageFlagTone } from '../utils/message-meta'
import MessageDetailMeta from './MessageDetailMeta.vue'
import MessagePayloadSection from './MessagePayloadSection.vue'

const props = defineProps<{
  connectionId: string
  messageId: number
}>()

const emit = defineEmits<{ close: [] }>()

const messages = useMessagesStore()
const subscriptions = useSubscriptionsStore()
const connections = useConnectionsStore()
const mqtt = computed(() => {
  const profile = connections.get(props.connectionId)
  return !profile || isMqttProfile(profile)
})
const actions = useMessageActions(() => props.connectionId)
const command = useCopyCommand(() => props.connectionId)
const publishing = ref(false)
const uid = useId()

const message = computed(() => messages.findById(props.connectionId, props.messageId) ?? null)
const incoming = computed(() => message.value?.direction !== 'out')
/** The subscription that delivered an incoming message (by identifier, else by topic). */
const via = computed(() => {
  const current = message.value
  if (!current || current.direction !== 'in') return undefined
  return subscriptions.subscriptionForMessage(props.connectionId, current)
})
const summary = computed(() =>
  message.value ? messageSummary(message.value, { qos: mqtt.value }) : null
)
const commands = computed(() => (message.value ? command.itemsFor(message.value) : []))

const FLAG_TONES: Readonly<Record<MessageFlagTone, string>> = {
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/15 text-warning',
  neutral: 'border text-muted-foreground'
}

async function publishAgain(): Promise<void> {
  if (!message.value || publishing.value) return
  publishing.value = true
  try {
    await actions.publishAgain(message.value)
  } finally {
    publishing.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  // Inputs keep their Escape; the read-only payload viewer does not need it.
  const target = event.target
  const inViewer = target instanceof Element && !!target.closest('.cm-content')
  if (isEditableTarget(target) && !inViewer) return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}
</script>

<template>
  <aside
    data-testid="message-detail"
    aria-label="Message details"
    class="@container/detail flex h-full min-h-0 min-w-0 flex-col bg-background"
    @keydown="onKeydown"
  >
    <header class="flex h-10 shrink-0 items-center gap-2 border-b pr-1.5 pl-3">
      <span
        v-if="message"
        class="inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium"
        :class="incoming ? 'bg-incoming/10 text-incoming' : 'bg-outgoing/10 text-outgoing'"
      >
        <ArrowDownLeftIcon v-if="incoming" class="size-3.5" aria-hidden="true" />
        <ArrowUpRightIcon v-else class="size-3.5" aria-hidden="true" />
        {{ DIRECTION_LABELS[message.direction] }}
      </span>
      <h2 class="truncate text-sm font-medium">Message</h2>
      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <template v-if="message">
          <IconButton label="Copy topic" @click="actions.copyTopic(message)">
            <HashIcon />
          </IconButton>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="More actions"
                    class="text-muted-foreground hover:text-foreground"
                  >
                    <EllipsisIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" class="w-56">
              <DropdownMenuItem @select="actions.copyAsJson(message)">
                <BracesIcon />
                Copy as JSON
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid="copy-as-command">
                  <TerminalIcon />
                  Copy as command
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent class="w-64">
                  <template v-for="item in commands" :key="item.tool">
                    <DropdownMenuItem
                      :data-testid="item.testId"
                      :disabled="!item.result.ok"
                      :aria-describedby="item.reason ? `${uid}-${item.tool}` : undefined"
                      @select="command.copy(item)"
                    >
                      <span class="font-mono text-xs">{{ item.label }}</span>
                    </DropdownMenuItem>
                    <p
                      v-if="item.reason"
                      :id="`${uid}-${item.tool}`"
                      class="px-1.5 pb-1.5 text-xs leading-snug text-muted-foreground"
                    >
                      {{ item.reason }}
                    </p>
                  </template>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem @select="actions.filterByTopic(message.topic)">
                <ListFilterIcon />
                Filter by this topic
              </DropdownMenuItem>
              <DropdownMenuItem @select="actions.showInTopicTree(message.topic)">
                <ListTreeIcon />
                Show in topic tree
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </template>
        <IconButton label="Close" :shortcut="SHORTCUTS.closeDetail.keys" @click="emit('close')">
          <XIcon />
        </IconButton>
      </div>
    </header>

    <template v-if="message && summary">
      <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto scrollbar-slim">
        <div class="flex flex-col gap-3 p-3">
          <div class="flex flex-col gap-1">
            <TopicLabel
              :topic="message.topic"
              :truncate="false"
              class="text-[13px] leading-snug font-medium"
            />
            <p v-if="via" class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span
                class="size-2 shrink-0 rounded-full"
                :style="{ backgroundColor: via.color }"
                aria-hidden="true"
              />
              <span class="shrink-0">via</span>
              <span v-if="via.alias" class="truncate text-foreground">{{ via.alias }}</span>
              <TopicLabel v-else :topic="via.topic" class="min-w-0" />
            </p>
            <p
              data-testid="message-detail-summary"
              class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            >
              <span class="font-mono text-muted-foreground tabular-nums select-text">{{
                summary.line
              }}</span>
              <span
                v-for="flag in summary.flags"
                :key="flag.label"
                :title="flag.title"
                class="inline-flex h-[18px] shrink-0 items-center rounded-[4px] px-1.5 text-[11px] leading-none font-medium"
                :class="FLAG_TONES[flag.tone]"
              >
                {{ flag.label }}
              </span>
            </p>
          </div>
          <MessagePayloadSection :connection-id="connectionId" :message="message" />
          <MessageDetailMeta :message="message" :no-flags="!mqtt" />
        </div>
      </div>
      <!-- One row: on a narrow pane the icons go first. -->
      <footer class="flex shrink-0 items-center gap-2 overflow-hidden border-t px-3 py-2">
        <Button size="sm" class="min-w-0" @click="actions.editAndPublish(message)">
          <SquarePenIcon class="hidden @2xs/detail:block" />
          Edit &amp; publish
        </Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="!actions.canPublish.value || publishing"
          :title="actions.canPublish.value ? undefined : 'Connect to publish'"
          class="min-w-0"
          @click="publishAgain"
        >
          <Spinner v-if="publishing" />
          <RepeatIcon v-else class="hidden @2xs/detail:block" />
          Publish again
        </Button>
      </footer>
    </template>

    <EmptyState
      v-else
      compact
      :icon="GhostIcon"
      title="This message is no longer in memory"
      description="It was cleared, or dropped to stay within the message limit."
      class="min-h-0 flex-1"
    >
      <Button size="sm" variant="outline" @click="emit('close')">Close</Button>
    </EmptyState>
  </aside>
</template>
