<script setup lang="ts">
/**
 * Context menu content of a subscription row (render inside its `ContextMenu`). The key hints
 * are the keys of the focused subscription list. "Copy as command" offers the subscription as a
 * mosquitto_sub or MQTTX command (FP-4); an entry the generator cannot express is disabled with
 * its reason. The commands are built only while the menu is open.
 */
import { computed } from 'vue'
import {
  CopyIcon,
  CopyPlusIcon,
  FilterXIcon,
  ListFilterIcon,
  NetworkIcon,
  PencilIcon,
  PowerIcon,
  PowerOffIcon,
  TerminalIcon,
  Trash2Icon
} from '@lucide/vue'
import type { ConnectionProfile, Subscription } from '@shared/models'
import { formatShortcutKey, isMacPlatform } from '@/components/common'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { hostPlatform } from '@/composables'
import { defaultCliShell } from '@/utils/cli-command'
import { copyCommand, subscriptionCommandItems } from '../utils/copy-command'
import { LIST_KEYS } from '../utils/list-keys'

const props = defineProps<{
  subscription: Subscription
  /** Profile of the connection (the commands need its host, port, TLS…). */
  profile: ConnectionProfile | undefined
  filtered: boolean
  enabled: boolean
  /** The filter has a literal prefix to open in the topic tree. */
  canShowTopic: boolean
}>()

const emit = defineEmits<{
  toggleFilter: []
  showTopic: []
  copy: []
  edit: []
  duplicate: []
  setEnabled: [enabled: boolean]
  remove: []
}>()

const platform = hostPlatform()
const mac = isMacPlatform(platform)
const commands = computed(() =>
  props.profile
    ? subscriptionCommandItems(props.profile, props.subscription, defaultCliShell(platform))
    : []
)
const keys = Object.fromEntries(
  Object.entries(LIST_KEYS).map(([action, name]) => [
    action,
    formatShortcutKey(name === 'Delete' && mac ? 'Backspace' : name, mac)
  ])
) as Record<keyof typeof LIST_KEYS, string>
</script>

<template>
  <ContextMenuContent class="w-56">
    <ContextMenuItem @select="emit('toggleFilter')">
      <FilterXIcon v-if="filtered" />
      <ListFilterIcon v-else />
      {{ filtered ? 'Show all messages' : 'Filter messages' }}
      <ContextMenuShortcut class="tracking-normal">{{ keys.activate }}</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem v-if="canShowTopic" @select="emit('showTopic')">
      <NetworkIcon />
      Show in topic tree
    </ContextMenuItem>
    <ContextMenuItem @select="emit('copy')">
      <CopyIcon />
      Copy filter
      <ContextMenuShortcut class="tracking-normal">{{ keys.copy }}</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuSub v-if="commands.length > 0">
      <ContextMenuSubTrigger data-testid="subscription-copy-command">
        <TerminalIcon />
        Copy as command
      </ContextMenuSubTrigger>
      <ContextMenuSubContent class="w-64">
        <ContextMenuItem
          v-for="item in commands"
          :key="item.tool"
          :disabled="item.disabled"
          :data-testid="`subscription-copy-${item.tool}`"
          class="flex-col items-start gap-0.5 data-disabled:opacity-100"
          @select="copyCommand(item.result)"
        >
          <span
            class="font-mono text-[13px]"
            :class="item.disabled && 'text-muted-foreground line-through'"
          >
            {{ item.label }}
          </span>
          <span v-if="item.reason" class="text-xs text-pretty text-muted-foreground">
            {{ item.reason }}
          </span>
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuSeparator />
    <ContextMenuItem @select="emit('edit')">
      <PencilIcon />
      Edit…
      <ContextMenuShortcut class="tracking-normal">{{ keys.edit }}</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem @select="emit('duplicate')">
      <CopyPlusIcon />
      Duplicate…
    </ContextMenuItem>
    <ContextMenuItem @select="emit('setEnabled', !enabled)">
      <PowerOffIcon v-if="enabled" />
      <PowerIcon v-else />
      {{ enabled ? 'Disable' : 'Enable' }}
      <ContextMenuShortcut class="tracking-normal">{{ keys.toggle }}</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem variant="destructive" @select="emit('remove')">
      <Trash2Icon />
      Delete
      <ContextMenuShortcut class="tracking-normal">{{ keys.remove }}</ContextMenuShortcut>
    </ContextMenuItem>
  </ContextMenuContent>
</template>
