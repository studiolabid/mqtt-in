<script setup lang="ts">
/**
 * "More actions" menu of the workspace header.
 */
import { computed } from 'vue'
import {
  CopyPlusIcon,
  DownloadIcon,
  EllipsisIcon,
  EraserIcon,
  LinkIcon,
  ListPlusIcon,
  Trash2Icon
} from '@lucide/vue'
import { isMqttProfile } from '@shared/connection-kind'
import { KbdShortcut } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hostPlatform, useConnectionActions } from '@/composables'
import { useConnectionsStore, useUiStore } from '@/stores'
import { SHORTCUTS } from '@/utils/shortcuts'

const props = defineProps<{ connectionId: string }>()

const ui = useUiStore()
/** One export at a time, from any entry point (RC-22). */
const connections = useConnectionsStore()
const mqtt = computed(() => {
  const profile = connections.get(props.connectionId)
  return !profile || isMqttProfile(profile)
})
const actions = useConnectionActions()
const platform = hostPlatform()
</script>

<template>
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger as-child>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="text-muted-foreground"
            aria-label="More actions"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom">More actions</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="end" class="w-64">
      <DropdownMenuItem
        v-if="mqtt"
        @select="ui.openNewSubscription(props.connectionId, { topic: '' })"
      >
        <ListPlusIcon />
        New subscription
        <DropdownMenuShortcut>
          <KbdShortcut :keys="SHORTCUTS.newSubscription.keys" :platform="platform" />
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem @select="actions.duplicate(connectionId)">
        <CopyPlusIcon />
        Duplicate
      </DropdownMenuItem>
      <DropdownMenuItem
        :disabled="connections.exporting"
        @select="actions.exportProfile(connectionId)"
      >
        <DownloadIcon />
        Export…
      </DropdownMenuItem>
      <DropdownMenuItem @select="actions.copyBrokerUrl(connectionId)">
        <LinkIcon />
        Copy broker URL
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="actions.clearMessages(connectionId)">
        <EraserIcon />
        Clear messages
        <DropdownMenuShortcut>
          <KbdShortcut :keys="SHORTCUTS.clearMessages.keys" :platform="platform" />
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" @select="actions.remove(connectionId)">
        <Trash2Icon />
        Delete connection…
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
