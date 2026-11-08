<script setup lang="ts">
/**
 * Context menu of the topic tree: topic actions for the row under the pointer (or the selected
 * row, for the keyboard), or tree-wide actions when opened on empty space. Rendered inside the
 * tree's `ContextMenu`.
 *
 * Retained messages (FP-1, PRODUCT-03): "Clear retained message" for any topic whose last
 * message has a payload (the retain flag of live deliveries is usually not set, so "unknown"
 * is not "none"), and "Clear retained below… (N)" on a branch with N known-retained topics.
 * Both are destructive and need a connection.
 */
import {
  BellPlusIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  ListFilterIcon,
  PinOffIcon,
  SendHorizontalIcon
} from '@lucide/vue'
import { KbdShortcut } from '@/components/common'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut
} from '@/components/ui/context-menu'
import { formatNumber } from '@/utils/format'
import { useTopicActions } from '../composables/useTopicActions'
import type { TreeMenuTarget } from '../utils/tree-views'

const props = defineProps<{
  connectionId: string
  /** `null` = opened on empty space. */
  target: TreeMenuTarget | null
}>()

const emit = defineEmits<{
  expandBranch: [topic: string]
  collapseBranch: [topic: string]
  expandAll: []
  collapseAll: []
}>()

const actions = useTopicActions(() => props.connectionId)
</script>

<template>
  <ContextMenuContent class="w-64">
    <template v-if="target">
      <ContextMenuLabel class="truncate font-mono font-normal" :title="target.topic">
        {{ target.topic || '(empty level)' }}
      </ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem @select="actions.copyTopic(target.topic)">
        <CopyIcon aria-hidden="true" />
        Copy topic
        <ContextMenuShortcut><KbdShortcut :keys="['Mod', 'C']" /></ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem @select="actions.publishTo(target.topic)">
        <SendHorizontalIcon aria-hidden="true" />
        Publish to topic
      </ContextMenuItem>
      <ContextMenuItem @select="actions.filterMessages(target.topic, target.hasChildren)">
        <ListFilterIcon aria-hidden="true" />
        {{ target.hasChildren ? 'Filter messages below' : 'Filter messages' }}
      </ContextMenuItem>
      <ContextMenuItem @select="actions.subscribe(target.topic, target.hasChildren)">
        <BellPlusIcon aria-hidden="true" />
        Subscribe…
      </ContextMenuItem>
      <template v-if="target.hasChildren">
        <ContextMenuSeparator />
        <ContextMenuItem @select="emit('expandBranch', target.topic)">
          <ChevronsUpDownIcon aria-hidden="true" />
          Expand all below
        </ContextMenuItem>
        <ContextMenuItem v-if="target.expanded" @select="emit('collapseBranch', target.topic)">
          <ChevronsDownUpIcon aria-hidden="true" />
          Collapse
        </ContextMenuItem>
      </template>
      <template v-if="target.hasPayload || (target.hasChildren && target.retainedBelow > 0)">
        <ContextMenuSeparator />
        <ContextMenuItem
          v-if="target.hasPayload"
          data-testid="topic-menu-clear-retained"
          variant="destructive"
          :disabled="!actions.connected.value || actions.isClearing(target.topic)"
          @select="actions.clearRetained(target.topic, { known: target.retained })"
        >
          <PinOffIcon aria-hidden="true" />
          Clear retained message
        </ContextMenuItem>
        <ContextMenuItem
          v-if="target.hasChildren && target.retainedBelow > 0"
          data-testid="topic-clear-retained-below"
          variant="destructive"
          :disabled="!actions.connected.value || actions.isClearingBelow(target.topic)"
          @select="actions.clearRetainedBelow(target.topic)"
        >
          <PinOffIcon aria-hidden="true" />
          Clear retained below… ({{ formatNumber(target.retainedBelow) }})
        </ContextMenuItem>
      </template>
    </template>
    <template v-else>
      <ContextMenuItem @select="emit('expandAll')">
        <ChevronsUpDownIcon aria-hidden="true" />
        Expand all
      </ContextMenuItem>
      <ContextMenuItem @select="emit('collapseAll')">
        <ChevronsDownUpIcon aria-hidden="true" />
        Collapse all
      </ContextMenuItem>
    </template>
  </ContextMenuContent>
</template>
