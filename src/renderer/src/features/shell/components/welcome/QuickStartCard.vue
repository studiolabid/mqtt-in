<script setup lang="ts">
/**
 * A quick start card (button): icon tile, title, address in mono and a one-line description.
 */
import type { Component } from 'vue'
import { ArrowUpRightIcon } from '@lucide/vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  title: string
  description: string
  address: string
  icon: Component
  /** Dashed outline (the "configure your own" card). */
  dashed?: boolean
}>()

defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    :class="
      cn(
        'group/card relative flex min-w-0 flex-col gap-2.5 rounded-xl border bg-card p-3 text-left transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:border-primary/35 hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring dark:bg-card/70',
        props.dashed && 'border-dashed bg-transparent dark:bg-transparent'
      )
    "
    @click="$emit('click')"
  >
    <span class="flex min-w-0 items-center gap-2.5">
      <span
        class="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground shadow-xs transition-colors group-hover/card:text-primary-text"
      >
        <component :is="icon" class="size-4" aria-hidden="true" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium">{{ title }}</span>
        <span class="block truncate font-mono text-[11px] text-muted-foreground" :title="address">
          {{ address }}
        </span>
      </span>
      <ArrowUpRightIcon
        class="size-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,translate] duration-150 group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5 group-hover/card:opacity-100 group-focus-visible/card:opacity-100 motion-reduce:transition-none"
        aria-hidden="true"
      />
    </span>
    <span class="line-clamp-2 text-xs text-muted-foreground">{{ description }}</span>
  </button>
</template>
