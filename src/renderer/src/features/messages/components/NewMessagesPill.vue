<script setup lang="ts">
/**
 * Floating "N new ↓" pill shown while the list is scrolled away from the newest message.
 * Without new messages it shrinks to a plain "jump to latest" arrow.
 */
import { computed } from 'vue'
import { ArrowDownIcon } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { KbdShortcut } from '@/components/common'
import { formatCompact, formatNumber } from '@/utils/format'

const props = defineProps<{
  /** New messages below the viewport. */
  count: number
}>()

const emit = defineEmits<{ jump: [] }>()

const label = computed(() =>
  props.count > 0
    ? `${formatNumber(props.count)} new message${props.count === 1 ? '' : 's'}`
    : 'Jump to latest'
)
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        :aria-label="label"
        class="absolute bottom-3 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border border-transparent bg-primary text-xs font-medium text-primary-foreground shadow-md outline-none animate-in fade-in-0 slide-in-from-bottom-2 duration-150 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        :class="count > 0 ? 'px-3' : 'w-7 justify-center'"
        @click="emit('jump')"
      >
        <span v-if="count > 0" class="font-mono tabular-nums">{{ formatCompact(count) }} new</span>
        <ArrowDownIcon class="size-3.5" aria-hidden="true" />
      </button>
    </TooltipTrigger>
    <TooltipContent side="top">
      {{ label }}
      <KbdShortcut :keys="['End']" />
    </TooltipContent>
  </Tooltip>
</template>
