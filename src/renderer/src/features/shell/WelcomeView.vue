<script setup lang="ts">
/**
 * Home screen (no connection open): hero with the primary actions, quick start presets, recent
 * connections, a compact keyboard cheat sheet and the "Powered by" credit. Lays itself out with
 * container queries, so it adapts to the content area (sidebar open or not), and scrolls when the
 * window is short.
 */
import { computed } from 'vue'
import { PoweredBy } from '@/components/common'
import { useConnectionsStore } from '@/stores'
import QuickStart from './components/welcome/QuickStart.vue'
import RecentConnections from './components/welcome/RecentConnections.vue'
import WelcomeBackdrop from './components/welcome/WelcomeBackdrop.vue'
import WelcomeHero from './components/welcome/WelcomeHero.vue'
import WelcomeShortcuts from './components/welcome/WelcomeShortcuts.vue'

const connections = useConnectionsStore()
const hasConnections = computed(() => connections.profiles.length > 0)
</script>

<template>
  <div
    data-testid="welcome"
    class="@container relative isolate h-full min-h-0 overflow-y-auto scrollbar-slim"
  >
    <WelcomeBackdrop />
    <div
      class="relative mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10 @3xl:px-10 @3xl:py-14"
    >
      <WelcomeHero class="welcome-reveal" />

      <div
        class="grid min-w-0 gap-8 @4xl:gap-10"
        :class="hasConnections && '@4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'"
      >
        <!-- Returning users see their connections first while the layout is a single column. -->
        <RecentConnections v-if="hasConnections" class="welcome-reveal [--i:1] @4xl:order-last" />
        <QuickStart class="welcome-reveal [--i:2]" />
      </div>

      <WelcomeShortcuts class="welcome-reveal [--i:3]" />

      <PoweredBy class="welcome-reveal text-center [--i:4]" />
    </div>
  </div>
</template>

<style scoped>
.welcome-reveal {
  animation: welcome-rise 200ms ease-out both;
  animation-delay: calc(var(--i, 0) * 50ms);
}

@keyframes welcome-rise {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-reveal {
    animation: none;
  }
}
</style>
