<script setup lang="ts">
/**
 * Status bar: the open connection's session (status, last error, client id, uptime), the last
 * measured round trip ("RTT 34 ms", warning tone above 500 ms, FP-5) and its live in / out rates
 * with a one-minute trend. Uptime, RTT and rates are also given as text to screen readers
 * (A11Y-20): their hover titles are not reachable by keyboard.
 */
import { computed } from 'vue'
import { ArrowDownIcon, ArrowUpIcon, FingerprintIcon, TimerIcon } from '@lucide/vue'
import { Sparkline, StatusDot } from '@/components/common'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCopy, useFormatters, useThrottledValue } from '@/composables'
import { useMessagesStore, useSessionsStore } from '@/stores'
import { statusLabel } from '@/utils/connection'

const props = defineProps<{
  connectionId: string
  /** Epoch ms of the sampler clock (drives the uptime). */
  now: number
  inRates: readonly number[]
  outRates: readonly number[]
}>()

const sessions = useSessionsStore()
const messages = useMessagesStore()
const fmt = useFormatters()
const { copy } = useCopy()

const session = computed(() => sessions.get(props.connectionId))
const status = computed(() => session.value.status)
const connected = computed(() => status.value === 'connected')
const error = computed(() =>
  status.value === 'error' || status.value === 'reconnecting' ? session.value.error : undefined
)
const uptime = computed(() => {
  const since = session.value.connectedAt
  return connected.value && since !== undefined ? fmt.duration(props.now - since) : null
})
const connectedSince = computed(() => {
  const since = session.value.connectedAt
  return since !== undefined ? `Connected since ${fmt.date(since)} ${fmt.clock(since)}` : ''
})
/** Live rates (the trend lines use the 1 Hz samples). */
const stats = useThrottledValue(() => messages.stats(props.connectionId), 500)
const inRate = computed(() => fmt.rate(stats.value.inRate))
const outRate = computed(() => fmt.rate(stats.value.outRate))
/** Round trips above this read in the warning tone. */
const SLOW_RTT_MS = 500
const rtt = computed(() => sessions.rttMs(props.connectionId))
</script>

<template>
  <div class="flex min-w-0 items-center gap-3">
    <span class="flex min-w-0 shrink-0 items-center gap-1.5">
      <StatusDot :status="status" size="xs" />
      <span :class="status === 'error' ? 'text-destructive' : undefined">
        {{ statusLabel(status) }}
      </span>
    </span>

    <span
      v-if="error"
      class="max-w-64 min-w-0 truncate"
      :class="status === 'error' ? 'text-destructive' : undefined"
      :title="error"
    >
      {{ error }}
    </span>

    <Tooltip v-if="session.clientId">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="flex min-w-0 items-center gap-1 rounded px-1 font-mono transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="`Copy client ID ${session.clientId}`"
          @click="copy(session.clientId, 'client ID')"
        >
          <FingerprintIcon class="size-3 shrink-0" aria-hidden="true" />
          <span class="max-w-44 truncate">{{ session.clientId }}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" class="block max-w-80">
        <span class="block font-mono wrap-anywhere">{{ session.clientId }}</span>
        <span class="mt-0.5 block opacity-70">Client ID · click to copy</span>
      </TooltipContent>
    </Tooltip>

    <span
      v-if="uptime"
      class="flex shrink-0 items-center gap-1 font-mono tabular-nums"
      :title="connectedSince"
    >
      <TimerIcon class="size-3" aria-hidden="true" />
      <span class="sr-only">Connected for</span>
      {{ uptime }}
    </span>

    <span
      v-if="rtt !== undefined"
      data-testid="status-rtt"
      class="flex shrink-0 items-center gap-1 font-mono tabular-nums"
      :class="rtt > SLOW_RTT_MS && 'text-warning'"
      :data-slow="rtt > SLOW_RTT_MS || undefined"
      title="Round trip of the last ping or acknowledged publish"
    >
      <span aria-hidden="true">RTT</span>
      <span class="sr-only">Round trip</span>
      {{ fmt.number(Math.round(rtt)) }} ms
    </span>

    <template v-if="connected">
      <span
        class="flex shrink-0 items-center gap-1"
        title="Incoming messages per second (last minute)"
      >
        <ArrowDownIcon class="size-3 text-incoming" aria-hidden="true" />
        <span class="sr-only">Incoming</span>
        <span class="min-w-[5ch] font-mono tabular-nums">{{ inRate }}</span>
        <Sparkline :values="inRates" color="var(--incoming)" :width="36" :height="12" />
      </span>
      <span
        class="flex shrink-0 items-center gap-1"
        title="Outgoing messages per second (last minute)"
      >
        <ArrowUpIcon class="size-3 text-outgoing" aria-hidden="true" />
        <span class="sr-only">Outgoing</span>
        <span class="min-w-[5ch] font-mono tabular-nums">{{ outRate }}</span>
        <Sparkline :values="outRates" color="var(--outgoing)" :width="36" :height="12" />
      </span>
    </template>
  </div>
</template>
