<script setup lang="ts">
/**
 * Centered empty state: icon tile on a faint dotted halo, title, description and an actions
 * slot (put the primary action first). `compact` fits narrow panels and list placeholders.
 * Centering is "safe": in a panel shorter than the content it starts at the top and scrolls
 * instead of overflowing upward over the tabs or toolbar above it.
 */
import type { Component, HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'

const props = withDefaults(
  defineProps<{
    icon?: Component
    title: string
    description?: string
    compact?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { compact: false }
)
</script>

<template>
  <Empty
    data-slot="empty-state"
    :class="
      cn(
        'min-h-0 justify-[safe_center] overflow-x-hidden overflow-y-auto animate-in fade-in-0 duration-200',
        compact ? 'gap-3 p-4' : 'gap-5 p-8',
        props.class
      )
    "
  >
    <EmptyHeader :class="compact ? 'gap-1.5' : 'gap-2'">
      <EmptyMedia v-if="icon" class="relative mb-1.5">
        <span aria-hidden="true" class="empty-state-dots pointer-events-none absolute -inset-7" />
        <span
          :class="
            cn(
              'relative flex items-center justify-center border bg-background text-muted-foreground shadow-xs',
              compact ? 'size-9 rounded-lg' : 'size-11 rounded-xl'
            )
          "
        >
          <component :is="icon" :class="compact ? 'size-4' : 'size-5'" aria-hidden="true" />
        </span>
      </EmptyMedia>
      <EmptyTitle :class="compact ? 'text-[13px]' : 'text-sm'">{{ title }}</EmptyTitle>
      <EmptyDescription v-if="description" :class="compact ? 'text-xs/relaxed' : 'text-sm/relaxed'">
        {{ description }}
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent v-if="$slots.default" class="flex-row flex-wrap justify-center gap-2">
      <slot />
    </EmptyContent>
  </Empty>
</template>

<style scoped>
.empty-state-dots {
  background-image: radial-gradient(
    color-mix(in oklab, var(--muted-foreground) 38%, transparent) 1px,
    transparent 1.5px
  );
  background-size: 9px 9px;
  background-position: center;
  mask-image: radial-gradient(closest-side, black 15%, transparent 100%);
}
</style>
