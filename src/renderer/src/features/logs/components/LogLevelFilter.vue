<script setup lang="ts">
/**
 * Level filter: one toggle per level with its entry count (`v-model` = visible levels).
 * Labels collapse to dot + count in narrow panels; the tooltip names the level.
 *
 * The tooltip trigger is an inner span: a trigger on the toggle itself would overwrite the
 * toggle's `data-state` (on / off) with its own (closed / delayed-open).
 */
import type { LogLevel } from '@shared/models'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatCompact, formatNumber } from '@/utils/format'
import { LOG_LEVELS } from '@/utils/logs'
import { normalizeLevels } from '../composables/useLogView'
import { LEVEL_TONES } from '../utils/levels'
import { LOG_LEVEL_LABELS } from '../utils/log-text'

defineProps<{ counts: Record<LogLevel, number> }>()

const levels = defineModel<LogLevel[]>({ required: true })

function onUpdate(value: unknown): void {
  levels.value = normalizeLevels(Array.isArray(value) ? value : [])
}
</script>

<template>
  <ToggleGroup
    type="multiple"
    variant="outline"
    size="sm"
    :model-value="levels"
    aria-label="Log levels"
    class="shrink-0"
    @update:model-value="onUpdate"
  >
    <ToggleGroupItem
      v-for="level in LOG_LEVELS"
      :key="level"
      :value="level"
      :data-testid="`log-level-${level}`"
      :aria-label="`${LOG_LEVEL_LABELS[level]} (${formatNumber(counts[level])})`"
      class="px-0 font-normal text-muted-foreground group-data-[spacing=0]/toggle-group:px-0 data-[state=on]:text-foreground"
    >
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="flex h-full items-center gap-1.5 px-2">
            <span
              aria-hidden="true"
              :class="
                cn(
                  'size-1.5 shrink-0 rounded-full transition-opacity group-data-[state=off]/toggle:opacity-30',
                  LEVEL_TONES[level].dot
                )
              "
            />
            <span class="hidden @2xl/logs:inline">{{ LOG_LEVEL_LABELS[level] }}</span>
            <span class="font-mono text-[11px] text-muted-foreground tabular-nums">
              {{ formatCompact(counts[level]) }}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {{ levels.includes(level) ? 'Hide' : 'Show' }}
          {{ LOG_LEVEL_LABELS[level].toLowerCase() }} entries
        </TooltipContent>
      </Tooltip>
    </ToggleGroupItem>
  </ToggleGroup>
</template>
