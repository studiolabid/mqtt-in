<script setup lang="ts">
/**
 * Message timestamp in the user's format (settings): a live "12s ago" for the relative format,
 * otherwise the formatted time. The full date-time is the native tooltip.
 */
import { computed, type HTMLAttributes } from 'vue'
import { RelativeTime } from '@/components/common'
import { useFormatters } from '@/composables/useFormatters'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'
import { formatClock, formatDate } from '@/utils/format'

const props = defineProps<{
  /** Epoch ms. */
  timestamp: number
  class?: HTMLAttributes['class']
}>()

const settings = useSettingsStore()
const fmt = useFormatters()

const relative = computed(() => settings.settings.timestampFormat === 'relative')
const valid = computed(() => Number.isFinite(new Date(props.timestamp).getTime()))
const full = computed(() =>
  valid.value ? `${formatDate(props.timestamp)} ${formatClock(props.timestamp, true)}` : undefined
)
const iso = computed(() => (valid.value ? new Date(props.timestamp).toISOString() : undefined))
</script>

<template>
  <RelativeTime v-if="relative" :timestamp="timestamp" :class="props.class" />
  <time
    v-else
    :datetime="iso"
    :title="full"
    :class="cn('font-mono whitespace-nowrap tabular-nums', props.class)"
    >{{ valid ? fmt.time(timestamp) : '—' }}</time
  >
</template>
