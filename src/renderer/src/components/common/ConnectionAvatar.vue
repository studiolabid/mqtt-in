<script setup lang="ts">
/**
 * Connection avatar: initials on a soft tint of the connection color, with the color as text
 * and hairline ring (mixed toward the foreground so it stays readable in light and dark).
 * Optional status dot in the bottom-right corner; its ring uses `--avatar-surface`
 * (default `--background`), e.g. `class="[--avatar-surface:var(--sidebar)]"`.
 */
import { computed, type HTMLAttributes } from 'vue'
import type { ConnectionStatus } from '@shared/models'
import { cn } from '@/lib/utils'
import StatusDot from './StatusDot.vue'
import { initials } from './lib/initials'
import { connectionStatusLabel } from './lib/status'

const props = withDefaults(
  defineProps<{
    name: string
    /** Hex (or any CSS) color of the connection. */
    color: string
    status?: ConnectionStatus
    size?: 'xs' | 'sm' | 'md' | 'lg'
    class?: HTMLAttributes['class']
  }>(),
  { size: 'md' }
)

const SIZE = {
  xs: 'size-5 rounded-md text-[9px]',
  sm: 'size-6 rounded-md text-[10px]',
  md: 'size-8 rounded-lg text-xs',
  lg: 'size-10 rounded-xl text-sm'
} as const

const DOT_SIZE = { xs: 'xs', sm: 'xs', md: 'sm', lg: 'md' } as const

const letters = computed(() => initials(props.name))
const label = computed(() =>
  props.status ? `${props.name} (${connectionStatusLabel(props.status)})` : props.name
)
</script>

<template>
  <span
    data-slot="connection-avatar"
    role="img"
    :aria-label="label"
    :title="label"
    :style="{ '--avatar-color': color }"
    :class="
      cn(
        'connection-avatar relative inline-flex shrink-0 items-center justify-center font-semibold tracking-tight select-none',
        SIZE[size],
        props.class
      )
    "
  >
    <span aria-hidden="true" class="leading-none">{{ letters }}</span>
    <StatusDot
      v-if="status"
      :status="status"
      :size="DOT_SIZE[size]"
      aria-hidden="true"
      class="absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-[color:var(--avatar-surface,var(--background))]"
    />
  </span>
</template>

<style scoped>
.connection-avatar {
  background-color: color-mix(in oklab, var(--avatar-color) 14%, var(--background));
  color: color-mix(in oklab, var(--avatar-color) 62%, var(--foreground));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--avatar-color) 32%, transparent);
}

:global(.dark) .connection-avatar {
  background-color: color-mix(in oklab, var(--avatar-color) 22%, var(--background));
  color: color-mix(in oklab, var(--avatar-color) 72%, var(--foreground));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--avatar-color) 38%, transparent);
}
</style>
