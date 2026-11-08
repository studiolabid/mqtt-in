<script setup lang="ts">
/**
 * "12s ago" style timestamp. All instances share one ticker: recent times (< ~1 min) refresh
 * every second, older ones every 30 s. The native title shows the full local date-time.
 */
import { computed, onScopeDispose, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { formatClock, formatDate, formatRelative } from '@/utils/format'
import { holdSharedClock, sharedClock } from './lib/ticker'

const props = defineProps<{
  /** Epoch ms. */
  timestamp: number
  class?: HTMLAttributes['class']
}>()

/** Below this age (judged on the slow clock) the per-second clock is used. */
const RECENT_MS = 90_000

onScopeDispose(holdSharedClock())

/** Largest magnitude a JS Date can represent. */
const MAX_DATE_MS = 8.64e15

const valid = computed(
  () => Number.isFinite(props.timestamp) && Math.abs(props.timestamp) <= MAX_DATE_MS
)

const text = computed(() => {
  if (!valid.value) return '—'
  const slow = sharedClock.slow.value
  const now = slow - props.timestamp < RECENT_MS ? sharedClock.fast.value : slow
  return formatRelative(props.timestamp, now)
})

const full = computed(() =>
  valid.value ? `${formatDate(props.timestamp)} ${formatClock(props.timestamp, false)}` : undefined
)

const iso = computed(() => (valid.value ? new Date(props.timestamp).toISOString() : undefined))
</script>

<template>
  <time
    data-slot="relative-time"
    :datetime="iso"
    :title="full"
    :class="cn('tabular-nums', props.class)"
    >{{ text }}</time
  >
</template>
