<script setup lang="ts">
/**
 * Bottom status bar (h-7): active sessions on the left, the open connection's session and
 * live rates in the middle, its message buffer, the "Powered by" credit and the app version on
 * the right. A visually hidden live region announces connection changes (A11Y-17).
 */
import { computed } from 'vue'
import { APP_VENDOR } from '@shared/defaults'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppInfo, useNavigation } from '@/composables'
import { useConnectionsStore } from '@/stores'
import { useLiveSampler } from '../composables/useLiveSampler'
import { useStatusAnnouncer } from '../composables/useStatusAnnouncer'
import StatusBuffer from './status/StatusBuffer.vue'
import StatusConnection from './status/StatusConnection.vue'
import StatusSessions from './status/StatusSessions.vue'

const connections = useConnectionsStore()
const nav = useNavigation()

/** The open workspace's connection, while its profile exists. */
const connectionId = computed(() => {
  const id = nav.currentConnectionId.value
  return id !== null && connections.get(id) ? id : null
})

const sampler = useLiveSampler(() => connectionId.value)

const { message: announcement } = useStatusAnnouncer()

const { info } = useAppInfo()
const version = computed(() => info.value?.version ?? null)
</script>

<template>
  <footer
    data-testid="statusbar"
    class="flex h-7 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-t bg-sidebar px-1.5 text-[11px] text-muted-foreground select-none"
  >
    <StatusSessions />
    <div role="status" aria-live="polite" class="sr-only" data-testid="status-announcer">
      {{ announcement }}
    </div>

    <template v-if="connectionId">
      <span class="h-3.5 w-px shrink-0 bg-border" aria-hidden="true" />
      <StatusConnection
        :key="connectionId"
        :connection-id="connectionId"
        :now="sampler.now.value"
        :in-rates="sampler.inRates.value"
        :out-rates="sampler.outRates.value"
      />
    </template>

    <div class="ml-auto flex shrink-0 items-center gap-1">
      <StatusBuffer v-if="connectionId" :key="connectionId" :connection-id="connectionId" />
      <!-- Opens in the default browser (main/security.ts routes http(s) links to the OS). -->
      <a
        :href="APP_VENDOR.url"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="statusbar-powered-by"
        :aria-label="`Powered by ${APP_VENDOR.name}`"
        class="flex h-5 items-center rounded-md px-1.5 transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span class="hidden xl:inline">Powered by&nbsp;</span>
        <span class="font-medium text-foreground/80">{{ APP_VENDOR.name }}</span>
      </a>
      <Tooltip v-if="version">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="flex h-5 items-center rounded-md px-1.5 font-mono tabular-nums transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="`mqtt-in ${version}. About`"
            @click="nav.openSettings()"
          >
            v{{ version }}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="end">About mqtt-in</TooltipContent>
      </Tooltip>
    </div>
  </footer>
</template>
