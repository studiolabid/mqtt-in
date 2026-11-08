<script setup lang="ts">
/** Context menu of a sidebar item. */
import { computed } from 'vue'
import {
  ArrowUpRightIcon,
  CopyPlusIcon,
  FileOutputIcon,
  Link2Icon,
  PencilIcon,
  PlugIcon,
  Trash2Icon,
  UnplugIcon
} from '@lucide/vue'
import type { ConnectionProfile, ConnectionStatus } from '@shared/models'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut
} from '@/components/ui/context-menu'
import { hostPlatform } from '@/composables/useHotkey'
import { useConnectionsStore } from '@/stores/connections'
import { isActiveStatus } from '@/utils/connection'
import { useConnectionActions } from '@/composables/useConnectionActions'

const props = defineProps<{ profile: ConnectionProfile; status: ConnectionStatus }>()

const actions = useConnectionActions()
/** One export at a time, from any entry point (RC-22). */
const connections = useConnectionsStore()
const deleteKey = hostPlatform() === 'darwin' ? '⌫' : 'Del'

const active = computed(() => isActiveStatus(props.status))
const toggleLabel = computed(() => {
  if (props.status === 'connected') return 'Disconnect'
  if (active.value) return 'Cancel connecting'
  return 'Connect'
})
</script>

<template>
  <ContextMenuContent class="w-52">
    <ContextMenuItem @select="actions.open(profile.id)">
      <ArrowUpRightIcon aria-hidden="true" />
      Open
      <ContextMenuShortcut>↵</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem :disabled="status === 'disconnecting'" @select="actions.toggle(profile.id)">
      <UnplugIcon v-if="active" aria-hidden="true" />
      <PlugIcon v-else aria-hidden="true" />
      {{ toggleLabel }}
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem @select="actions.edit(profile.id)">
      <PencilIcon aria-hidden="true" />
      Edit…
      <ContextMenuShortcut>F2</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem @select="actions.duplicate(profile.id)">
      <CopyPlusIcon aria-hidden="true" />
      Duplicate
    </ContextMenuItem>
    <ContextMenuItem @select="actions.copyBrokerUrl(profile.id)">
      <Link2Icon aria-hidden="true" />
      Copy broker URL
    </ContextMenuItem>
    <ContextMenuItem :disabled="connections.exporting" @select="actions.exportProfile(profile.id)">
      <FileOutputIcon aria-hidden="true" />
      Export…
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem variant="destructive" @select="actions.remove(profile.id)">
      <Trash2Icon aria-hidden="true" />
      Delete…
      <ContextMenuShortcut>{{ deleteKey }}</ContextMenuShortcut>
    </ContextMenuItem>
  </ContextMenuContent>
</template>
