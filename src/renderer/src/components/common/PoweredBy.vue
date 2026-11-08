<script setup lang="ts">
/**
 * "Powered by studiolab.id" credit. The link opens in the default browser: the main process
 * hands http(s) links that would open a new window to the OS (main/security.ts).
 */
import type { HTMLAttributes } from 'vue'
import { APP_VENDOR } from '@shared/defaults'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <p data-testid="powered-by" :class="cn('text-xs text-muted-foreground', props.class)">
    Powered by
    <a
      :href="APP_VENDOR.url"
      target="_blank"
      rel="noopener noreferrer"
      class="rounded-sm font-medium text-foreground/80 underline-offset-4 transition-colors outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >{{ APP_VENDOR.name }}</a
    >
  </p>
</template>
