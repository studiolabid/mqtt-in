<script setup lang="ts">
/** Small "live" indicator in the outgoing color (a calm ping while a repeat job runs). */
</script>

<template>
  <span class="relative inline-flex size-2 shrink-0" aria-hidden="true">
    <span
      class="absolute inset-0 rounded-full bg-outgoing/60 motion-safe:animate-ping motion-reduce:scale-150 motion-reduce:opacity-30"
    />
    <span class="relative inline-flex size-full rounded-full bg-outgoing" />
  </span>
</template>
