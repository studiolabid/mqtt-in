<script setup lang="ts">
/**
 * Decorative welcome backdrop: a faint accent glow from the top and a dot grid that fades out.
 * Tokens only, so it follows the theme and the accent color.
 */
</script>

<template>
  <div
    aria-hidden="true"
    class="pointer-events-none absolute inset-x-0 top-0 h-[36rem] overflow-hidden select-none"
  >
    <div class="welcome-glow absolute inset-0" />
    <div class="welcome-dots absolute inset-0" />
  </div>
</template>

<style scoped>
.welcome-glow {
  background:
    radial-gradient(
      44rem 24rem at 14% -8%,
      color-mix(in oklab, var(--primary) 11%, transparent),
      transparent 72%
    ),
    radial-gradient(
      30rem 18rem at 92% -4%,
      color-mix(in oklab, var(--primary) 5%, transparent),
      transparent 70%
    );
}

.welcome-dots {
  background-image: radial-gradient(
    color-mix(in oklab, var(--muted-foreground) 24%, transparent) 1px,
    transparent 1.5px
  );
  background-size: 22px 22px;
  background-position: -11px -11px;
  mask-image: radial-gradient(64rem 30rem at 18% 0%, black 0%, transparent 72%);
}
</style>
