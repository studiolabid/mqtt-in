<script setup lang="ts">
/**
 * The mqtey mark (same drawing as resources/logo.svg): a rounded square with a client dot and
 * two broadcast arcs. Monochrome and theme-aware: an ink tile (`foreground`) with the marks in the
 * page color (`background`), so it is black on light and white on dark.
 */
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    /** Accessible name; omit for a decorative logo next to the wordmark. */
    label?: string
    class?: HTMLAttributes['class']
  }>(),
  { label: undefined, class: undefined }
)
</script>

<template>
  <svg
    viewBox="0 0 1024 1024"
    :class="cn('size-6 shrink-0', props.class)"
    :role="props.label ? 'img' : undefined"
    :aria-label="props.label"
    :aria-hidden="props.label ? undefined : 'true'"
  >
    <rect x="48" y="48" width="928" height="928" rx="216" class="fill-foreground" />
    <circle cx="318" cy="706" r="84" class="fill-background" />
    <path
      d="M318 468 A238 238 0 0 1 556 706"
      fill="none"
      class="stroke-background"
      stroke-width="88"
      stroke-linecap="round"
    />
    <path
      d="M318 262 A444 444 0 0 1 762 706"
      fill="none"
      class="stroke-background"
      stroke-opacity="0.55"
      stroke-width="88"
      stroke-linecap="round"
    />
    <circle cx="762" cy="262" r="58" class="fill-background" fill-opacity="0.9" />
  </svg>
</template>
