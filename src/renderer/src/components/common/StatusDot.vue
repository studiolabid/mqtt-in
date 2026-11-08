<script setup lang="ts">
/**
 * Connection status indicator with one shape per state (`statusGlyph`), so it reads without
 * color too: a filled success dot with a soft glow when connected, a hollow muted ring when
 * disconnected, a warning ring with a pulse (motion-safe) while connecting / reconnecting /
 * disconnecting, and a destructive alert triangle on error. `data-glyph` names the shape.
 * Optionally followed by the status text.
 */
import { computed, type HTMLAttributes } from 'vue'
import type { ConnectionStatus } from '@shared/models'
import { cn } from '@/lib/utils'
import { connectionStatusLabel, statusGlyph, statusTone, type StatusGlyph } from './lib/status'

const props = withDefaults(
  defineProps<{
    status: ConnectionStatus
    size?: 'xs' | 'sm' | 'md'
    /** Show the status text next to the dot. */
    label?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { size: 'sm', label: false }
)

const SIZE = { xs: 'size-1.5', sm: 'size-2', md: 'size-2.5' } as const
/** Ring stroke per size: thick enough to read as a ring, thin enough to stay hollow. */
const RING = { xs: 'border-[1.5px]', sm: 'border-[1.5px]', md: 'border-2' } as const

/** Classes of the round glyphs (the alert triangle is an SVG). */
const SHAPE: Readonly<Record<StatusGlyph, string>> = {
  filled: 'bg-success status-dot-glow',
  ring: 'border-muted-foreground',
  pulse: 'border-warning',
  alert: ''
}

const text = computed(() => connectionStatusLabel(props.status))
const tone = computed(() => statusTone(props.status))
const glyph = computed(() => statusGlyph(props.status))
</script>

<template>
  <span
    data-slot="status-dot"
    :data-status="status"
    :data-glyph="glyph"
    :class="cn('inline-flex shrink-0 items-center gap-1.5', props.class)"
    :title="text"
    :role="label ? undefined : 'img'"
    :aria-label="label ? undefined : text"
  >
    <span class="relative inline-flex shrink-0" :class="SIZE[size]" aria-hidden="true">
      <span
        v-if="glyph === 'pulse'"
        class="absolute inset-0 rounded-full bg-warning/60 motion-safe:animate-ping motion-reduce:scale-150 motion-reduce:opacity-30"
      />
      <svg
        v-if="glyph === 'alert'"
        viewBox="0 0 16 16"
        class="relative size-full overflow-visible text-destructive"
      >
        <path
          d="M8 1.6 15 14.2H1Z"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
        <path d="M8 6v3.6" stroke="var(--background)" stroke-width="1.8" stroke-linecap="round" />
        <circle cx="8" cy="12" r="0.95" fill="var(--background)" />
      </svg>
      <span
        v-else
        class="relative inline-flex size-full rounded-full transition-colors"
        :class="[SHAPE[glyph], glyph !== 'filled' && RING[size]]"
      />
    </span>
    <span
      v-if="label"
      class="truncate text-xs"
      :class="tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ text }}
    </span>
  </span>
</template>

<style scoped>
.status-dot-glow {
  box-shadow:
    0 0 0 2px color-mix(in oklab, var(--success) 18%, transparent),
    0 0 6px 0 color-mix(in oklab, var(--success) 55%, transparent);
}
</style>
