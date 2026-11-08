<script setup lang="ts">
/**
 * One line of message metadata: received time, QoS, retain / duplicate flags and size (`bytes`:
 * the original size when `message` holds a cut copy of a large payload).
 */
import { computed } from 'vue'
import { ClockIcon, CopyPlusIcon, PinIcon } from '@lucide/vue'
import type { MqttMessage } from '@shared/models'
import { QosBadge } from '@/components/common'
import { useFormatters } from '@/composables/useFormatters'
import { formatNumber } from '@/utils/format'
import MessageTime from './MessageTime.vue'

const props = defineProps<{
  message: MqttMessage
  /** The payload's original size, when `message` holds a cut copy. */
  bytes?: number
}>()

const fmt = useFormatters()
const size = computed(() => props.bytes ?? props.message.payload.length)
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
    <span class="inline-flex items-center gap-1.5">
      <ClockIcon class="size-3.5 shrink-0" aria-hidden="true" />
      <MessageTime :timestamp="message.timestamp" class="text-foreground" />
    </span>
    <QosBadge :qos="message.qos" />
    <span
      v-if="message.retain"
      class="inline-flex items-center gap-1"
      title="Delivered as the broker's retained message"
    >
      <PinIcon class="size-3" aria-hidden="true" />
      Retained
    </span>
    <span v-if="message.dup" class="inline-flex items-center gap-1" title="Redelivery (DUP flag)">
      <CopyPlusIcon class="size-3" aria-hidden="true" />
      Duplicate
    </span>
    <span class="font-mono tabular-nums" :title="`${formatNumber(size)} bytes`">{{
      fmt.bytes(size)
    }}</span>
  </div>
</template>
