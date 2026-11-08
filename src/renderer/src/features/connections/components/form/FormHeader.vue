<script setup lang="ts">
/**
 * Dialog header: live avatar (name + color), title, the resulting broker URL and the close
 * button (closing goes through the dialog's unsaved-changes guard).
 */
import { computed } from 'vue'
import { XIcon } from '@lucide/vue'
import { brokerUrl, isWebSocketProtocol } from '@shared/defaults'
import { ConnectionAvatar, KbdShortcut } from '@/components/common'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { protocolLabel } from '@/utils/connection'
import { useConnectionForm } from '../../composables/useConnectionForm'

const { draft, mode } = useConnectionForm()

const address = computed(() => {
  const profile = draft.value
  const host = profile.host.trim()
  if (host === '') return 'No broker address yet'
  const port = profile.port
  const validPort = Number.isInteger(port) && port >= 1 && port <= 65_535
  const path = profile.path.trim()
  const url = validPort
    ? brokerUrl({ protocol: profile.protocol, host, port, path })
    : `${profile.protocol}://${host}${isWebSocketProtocol(profile.protocol) ? path : ''}`
  return `${url} · ${protocolLabel(profile.protocolVersion)}`
})
</script>

<template>
  <div class="flex shrink-0 items-center gap-3 border-b py-3.5 pr-3 pl-5">
    <ConnectionAvatar :name="draft.name.trim() || 'Connection'" :color="draft.color" size="lg" />
    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
      <DialogTitle class="truncate">
        {{ mode === 'create' ? 'New connection' : 'Edit connection' }}
      </DialogTitle>
      <DialogDescription
        class="truncate font-mono text-xs text-muted-foreground select-text"
        :title="address"
      >
        {{ address }}
      </DialogDescription>
    </div>
    <Tooltip>
      <TooltipTrigger as-child>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="shrink-0" aria-label="Close">
            <XIcon aria-hidden="true" />
          </Button>
        </DialogClose>
      </TooltipTrigger>
      <TooltipContent>Close <KbdShortcut :keys="['Esc']" /></TooltipContent>
    </Tooltip>
  </div>
</template>
