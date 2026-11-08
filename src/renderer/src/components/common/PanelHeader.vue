<script setup lang="ts">
/**
 * Panel header bar (`h-10 px-3 border-b`): icon, title, count pill and a muted description on
 * the left (or the default slot instead), actions on the right (`#actions`).
 */
import { computed, type Component, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { formatCompact, formatNumber } from '@/utils/format'

const props = defineProps<{
  title?: string
  icon?: Component
  /** Numbers are compacted (12.3K) with the exact value as tooltip. */
  count?: number | string
  description?: string
  class?: HTMLAttributes['class']
}>()

const countText = computed(() =>
  typeof props.count === 'number' ? formatCompact(props.count) : (props.count ?? '')
)
const countTitle = computed(() =>
  typeof props.count === 'number' ? formatNumber(props.count) : undefined
)
</script>

<template>
  <header
    data-slot="panel-header"
    :class="cn('flex h-10 shrink-0 items-center gap-2 border-b px-3', props.class)"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <slot>
        <component
          :is="icon"
          v-if="icon"
          class="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 v-if="title" class="truncate text-sm font-medium">{{ title }}</h2>
        <span
          v-if="countText !== ''"
          :title="countTitle"
          class="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-muted px-1.5 font-mono text-[11px] leading-none text-muted-foreground tabular-nums"
        >
          {{ countText }}
        </span>
        <span v-if="description" class="min-w-0 truncate text-xs text-muted-foreground">
          {{ description }}
        </span>
      </slot>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-0.5">
      <slot name="actions" />
    </div>
  </header>
</template>
