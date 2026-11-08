<script setup lang="ts">
/**
 * Context menu entries for one message (rendered inside the list's single ContextMenu),
 * including 'Copy as command' ▸ mosquitto_pub / mqttx pub. A command the generator cannot
 * build (e.g. a binary payload, or mosquitto over WebSockets) is disabled and says why.
 */
import { computed, useId } from 'vue'
import {
  BracesIcon,
  CopyIcon,
  HashIcon,
  ListFilterIcon,
  ListTreeIcon,
  RepeatIcon,
  SquarePenIcon,
  TerminalIcon
} from '@lucide/vue'
import type { MqttMessage } from '@shared/models'
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { TopicLabel } from '@/components/common'
import { useCopyCommand } from '../composables/useCopyCommand'
import { useMessageActions } from '../composables/useMessageActions'

const props = defineProps<{
  connectionId: string
  message: MqttMessage
}>()

const actions = useMessageActions(() => props.connectionId)
const command = useCopyCommand(() => props.connectionId)
const uid = useId()
const commands = computed(() => command.itemsFor(props.message))
</script>

<template>
  <ContextMenuLabel class="max-w-64 py-1">
    <TopicLabel :topic="message.topic" class="text-xs font-normal" />
  </ContextMenuLabel>
  <ContextMenuSeparator />
  <ContextMenuItem @select="actions.copyTopic(message)">
    <HashIcon />
    Copy topic
    <ContextMenuShortcut>T</ContextMenuShortcut>
  </ContextMenuItem>
  <ContextMenuItem @select="actions.copyPayload(message)">
    <CopyIcon />
    Copy payload
    <ContextMenuShortcut>C</ContextMenuShortcut>
  </ContextMenuItem>
  <ContextMenuItem @select="actions.copyAsJson(message)">
    <BracesIcon />
    Copy as JSON
  </ContextMenuItem>
  <ContextMenuSub>
    <ContextMenuSubTrigger data-testid="copy-as-command">
      <TerminalIcon />
      Copy as command
    </ContextMenuSubTrigger>
    <ContextMenuSubContent class="w-64">
      <template v-for="item in commands" :key="item.tool">
        <ContextMenuItem
          :data-testid="item.testId"
          :disabled="!item.result.ok"
          :aria-describedby="item.reason ? `${uid}-${item.tool}` : undefined"
          @select="command.copy(item)"
        >
          <span class="font-mono text-xs">{{ item.label }}</span>
        </ContextMenuItem>
        <p
          v-if="item.reason"
          :id="`${uid}-${item.tool}`"
          class="px-1.5 pb-1.5 text-xs leading-snug text-muted-foreground"
        >
          {{ item.reason }}
        </p>
      </template>
    </ContextMenuSubContent>
  </ContextMenuSub>
  <ContextMenuSeparator />
  <ContextMenuItem @select="actions.editAndPublish(message)">
    <SquarePenIcon />
    Edit &amp; publish
  </ContextMenuItem>
  <ContextMenuItem :disabled="!actions.canPublish.value" @select="actions.publishAgain(message)">
    <RepeatIcon />
    Publish again
  </ContextMenuItem>
  <ContextMenuSeparator />
  <ContextMenuItem @select="actions.filterByTopic(message.topic)">
    <ListFilterIcon />
    Filter by this topic
  </ContextMenuItem>
  <ContextMenuItem @select="actions.showInTopicTree(message.topic)">
    <ListTreeIcon />
    Show in topic tree
  </ContextMenuItem>
</template>
