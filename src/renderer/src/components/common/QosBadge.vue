<script setup lang="ts">
/**
 * Tiny `Q0` / `Q1` / `Q2` badge. Emphasis grows with the level (outline → tint → tint + ring).
 * The rich tooltip can be turned off (`:tooltip="false"`) in dense virtualized rows, where a
 * native `title` is used instead.
 */
import { computed, type HTMLAttributes } from 'vue'
import type { QoS } from '@shared/models'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { qosLevel } from './lib/qos'

// The root may be a renderless tooltip provider: forward attributes to the badge itself.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    qos: QoS
    /** Rich tooltip (true) or native title (false). */
    tooltip?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { tooltip: true }
)

// `text-primary-text`: the accent shade that stays readable as text (AA) in every accent.
const TONE: Readonly<Record<QoS, string>> = {
  0: 'border-border text-muted-foreground',
  1: 'border-transparent bg-primary/10 text-primary-text',
  2: 'border-primary/35 bg-primary/15 font-semibold text-primary-text'
}

const level = computed(() => qosLevel(props.qos))
const summary = computed(() => `QoS ${level.value.value} · ${level.value.label}`)
const badgeClass = computed(() =>
  cn(
    'inline-flex h-4 min-w-6 shrink-0 select-none items-center justify-center rounded-[4px] border px-1 font-mono text-[10px] leading-none font-medium tabular-nums',
    TONE[level.value.value],
    props.class
  )
)
</script>

<template>
  <TooltipProvider v-if="tooltip" :delay-duration="400">
    <Tooltip>
      <TooltipTrigger as-child>
        <span v-bind="$attrs" data-slot="qos-badge" :class="badgeClass">
          <span aria-hidden="true">Q{{ level.value }}</span>
          <span class="sr-only">{{ summary }}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" :side-offset="4" class="max-w-60 flex-col items-start gap-0.5">
        <span class="font-medium">{{ summary }}</span>
        <span class="opacity-75">{{ level.description }}</span>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <span
    v-else
    v-bind="$attrs"
    data-slot="qos-badge"
    :class="badgeClass"
    :title="`${summary}. ${level.description}`"
  >
    <span aria-hidden="true">Q{{ level.value }}</span>
    <span class="sr-only">{{ summary }}</span>
  </span>
</template>
