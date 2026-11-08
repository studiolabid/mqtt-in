<script setup lang="ts">
/**
 * The protocol badge of the workspace header ("MQTT 5.0") as a button that opens a "Broker"
 * popover (FP-5): what the broker announced in its CONNACK (session present, limits, features),
 * with the protocol default for anything it left out. Nothing new is visible until it is opened.
 */
import { computed } from 'vue'
import type { ConnectionProfile } from '@shared/models'
import { protocolLabel } from '@shared/defaults'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSessionsStore } from '@/stores'
import { brokerView } from '../utils/broker-rows'

const props = defineProps<{ profile: ConnectionProfile }>()

const sessions = useSessionsStore()

const label = computed(() => protocolLabel(props.profile.protocolVersion))
const view = computed(() =>
  brokerView({
    connected: sessions.isConnected(props.profile.id),
    info: sessions.brokerInfo(props.profile.id),
    protocolVersion: props.profile.protocolVersion,
    keepalive: props.profile.keepalive
  })
)
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        type="button"
        data-testid="broker-info-trigger"
        :aria-label="`${label}: what the broker supports`"
        class="inline-flex h-[18px] shrink-0 items-center rounded-md border px-1.5 font-mono text-[10px] text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-open:bg-muted data-open:text-foreground"
      >
        {{ label }}
      </button>
    </PopoverTrigger>
    <PopoverContent data-testid="broker-info" align="start" class="w-80 gap-0 p-0">
      <header class="border-b px-3 pt-2.5 pb-2">
        <h2 class="text-sm font-medium">Broker</h2>
        <p class="text-xs text-muted-foreground">
          What it announced when it accepted the connection
        </p>
      </header>
      <p v-if="view.message" class="px-3 pt-2.5 text-xs text-pretty text-muted-foreground">
        {{ view.message }}
      </p>
      <dl
        v-if="view.rows.length > 0"
        class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-3 pt-2.5 text-xs"
      >
        <template v-for="row in view.rows" :key="row.label">
          <dt class="text-muted-foreground">{{ row.label }}</dt>
          <dd
            :class="
              row.announced ? 'font-mono text-foreground tabular-nums' : 'text-muted-foreground'
            "
            class="wrap-anywhere select-text"
          >
            {{ row.value }}
          </dd>
        </template>
      </dl>
      <div class="h-2.5" aria-hidden="true" />
    </PopoverContent>
  </Popover>
</template>
