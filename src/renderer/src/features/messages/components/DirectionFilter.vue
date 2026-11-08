<script setup lang="ts">
/**
 * All / In / Out segmented filter bound to `ui.messageFilter(id).direction`. The active segment
 * uses the toggle group's own "on" style (readable in the Mono look, RC-08).
 */
import { computed } from 'vue'
import { ArrowDownLeftIcon, ArrowUpRightIcon } from '@lucide/vue'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useUiStore } from '@/stores'
import type { DirectionFilter } from '@/types'

const props = defineProps<{ connectionId: string }>()

const ui = useUiStore()
const direction = computed(() => ui.messageFilter(props.connectionId).direction)

function isDirection(value: unknown): value is DirectionFilter {
  return value === 'all' || value === 'in' || value === 'out'
}

function onChange(value: unknown): void {
  // Clicking the active segment emits an empty value: keep the current one.
  if (isDirection(value)) ui.updateMessageFilter(props.connectionId, { direction: value })
}

const ITEM = 'h-7 gap-1 px-2 text-xs text-muted-foreground data-[state=on]:text-foreground'
</script>

<template>
  <ToggleGroup
    type="single"
    variant="outline"
    size="sm"
    :model-value="direction"
    aria-label="Message direction"
    class="shrink-0"
    @update:model-value="onChange"
  >
    <ToggleGroupItem value="all" aria-label="All messages" :class="ITEM">All</ToggleGroupItem>
    <ToggleGroupItem value="in" aria-label="Incoming only" :class="ITEM">
      <ArrowDownLeftIcon class="size-3.5 text-incoming" aria-hidden="true" />
      In
    </ToggleGroupItem>
    <ToggleGroupItem value="out" aria-label="Outgoing only" :class="ITEM">
      <ArrowUpRightIcon class="size-3.5 text-outgoing" aria-hidden="true" />
      Out
    </ToggleGroupItem>
  </ToggleGroup>
</template>
