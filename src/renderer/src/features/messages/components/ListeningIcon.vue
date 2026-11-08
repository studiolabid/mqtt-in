<script setup lang="ts">
/**
 * Radio icon with a slow, soft ping — the "waiting for messages" state (reduced motion: still).
 */
import { RadioIcon } from '@lucide/vue'
</script>

<template>
  <span class="relative inline-flex items-center justify-center" aria-hidden="true">
    <span
      class="absolute -inset-1 rounded-full bg-primary/25 motion-safe:animate-ping motion-safe:[animation-duration:1.8s]"
    />
    <RadioIcon class="relative size-full text-primary-text" />
  </span>
</template>
