<script setup lang="ts">
/**
 * Status bar: messages kept in memory for the open connection, with a tiny fill gauge of the
 * ring buffer (warning tone once it is full and the oldest messages are dropped). The tooltip
 * adds the session totals: received, sent, dropped and the payload bytes held in memory (the
 * one home of these numbers, UX-14). Clicking opens the settings, where the limit is configured.
 */
import { computed } from 'vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFormatters, useNavigation, useThrottledValue } from '@/composables'
import { useMessagesStore, useSettingsStore } from '@/stores'

const props = defineProps<{ connectionId: string }>()

const messages = useMessagesStore()
const settings = useSettingsStore()
const nav = useNavigation()
const fmt = useFormatters()

const count = useThrottledValue(() => messages.count(props.connectionId), 250)
const stats = useThrottledValue(() => messages.stats(props.connectionId), 1000)
const totals = computed(() => {
  const { received, sent, dropped, retainedBytes } = stats.value
  const parts = [`received ${fmt.number(received)}`, `sent ${fmt.number(sent)}`]
  if (dropped > 0) parts.push(`${fmt.number(dropped)} dropped`)
  parts.push(`${fmt.bytes(retainedBytes)} in memory`)
  return parts.join(' · ')
})
const capacity = computed(() => Math.max(1, settings.settings.maxMessagesPerConnection))
const fill = computed(() => Math.min(100, (count.value / capacity.value) * 100))
const full = computed(() => count.value >= capacity.value)
const label = computed(() => (count.value === 1 ? 'message' : 'messages'))
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        class="flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="`${fmt.number(count)} ${label} in memory. Change the limit in the settings`"
        @click="nav.openSettings('messages')"
      >
        <span class="relative h-1.5 w-7 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span
            class="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-200"
            :class="full ? 'bg-warning' : 'bg-muted-foreground/60'"
            :style="{ width: `${fill}%` }"
          />
        </span>
        <span class="font-mono tabular-nums">{{ fmt.compact(count) }}</span>
        <span>{{ label }}</span>
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" align="end" class="block max-w-64">
      <p>{{ fmt.number(count) }} of {{ fmt.number(capacity) }} messages kept in memory</p>
      <p data-testid="status-buffer-totals" class="mt-0.5 font-mono tabular-nums">{{ totals }}</p>
      <p class="mt-0.5">Click to change the limit</p>
    </TooltipContent>
  </Tooltip>
</template>
