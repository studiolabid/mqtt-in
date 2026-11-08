<script setup lang="ts">
/**
 * Pause / resume the live view (messages keep arriving in memory). A toggle button with one
 * constant name, 'Pause live view': its state is `aria-pressed` only (A11Y-23). While paused it
 * turns into an amber "Paused · N new" pill, whose count is also its accessible description.
 * The tooltip shows the global shortcut (`SHORTCUTS.togglePause`, registered by the shell).
 */
import { computed, useId } from 'vue'
import { PauseIcon, PlayIcon } from '@lucide/vue'
import { HintTooltip } from '@/components/common'
import { Button } from '@/components/ui/button'
import { useThrottledValue } from '@/composables'
import { useMessagesStore } from '@/stores'
import { formatCompact, formatNumber } from '@/utils/format'
import { SHORTCUTS } from '@/utils/shortcuts'
import { usePausedBacklog } from '../composables/usePausedBacklog'

const props = defineProps<{ connectionId: string }>()

const messages = useMessagesStore()
const paused = computed(() => messages.isPaused(props.connectionId))
const backlog = usePausedBacklog(() => props.connectionId)
const shown = useThrottledValue(() => backlog.value, 250)
const countId = useId()

const tooltip = computed(() =>
  paused.value
    ? `Resume · ${formatNumber(shown.value)} message${shown.value === 1 ? '' : 's'} arrived while paused`
    : 'Pause the view (messages keep arriving in memory)'
)
</script>

<template>
  <HintTooltip :label="tooltip" :keys="SHORTCUTS.togglePause.keys" side="bottom">
    <Button
      data-testid="messages-pause"
      type="button"
      variant="ghost"
      :size="paused ? 'sm' : 'icon-sm'"
      aria-label="Pause live view"
      :aria-pressed="paused"
      :aria-describedby="paused ? countId : undefined"
      :class="
        paused
          ? 'gap-1.5 border-warning/30 bg-warning/10 px-2 text-warning hover:bg-warning/15 hover:text-warning dark:hover:bg-warning/15'
          : 'text-muted-foreground hover:text-foreground'
      "
      @click="messages.togglePaused(connectionId)"
    >
      <template v-if="paused">
        <PlayIcon aria-hidden="true" />
        <span :id="countId" class="text-xs font-medium">
          <span class="hidden @2xl/toolbar:inline">Paused · </span>
          <span class="font-mono tabular-nums">{{ formatCompact(shown) }}</span> new
        </span>
      </template>
      <PauseIcon v-else aria-hidden="true" />
    </Button>
  </HintTooltip>
</template>
