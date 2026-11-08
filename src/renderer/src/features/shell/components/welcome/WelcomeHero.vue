<script setup lang="ts">
/**
 * Welcome hero: the logo with faint broadcast arcs that continue the mark's own arcs, a
 * one-line pitch and the two primary actions (the only New connection / Import buttons of the
 * first screen, UX-15). When the screen opens after a navigation that removed the focused
 * element (Settings Back, a deleted connection), keyboard focus starts on its heading (A11Y-11).
 * Import shows the store's busy state, shared by every entry point (RC-22).
 */
import { onMounted, ref } from 'vue'
import { FileUpIcon, PlusIcon } from '@lucide/vue'
import { AppLogo, KbdShortcut } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { hostPlatform } from '@/composables'
import { useConnectionsStore, useUiStore } from '@/stores'
import { SHORTCUTS } from '@/utils/shortcuts'

const ui = useUiStore()
const connections = useConnectionsStore()
const platform = hostPlatform()

/** Arc radii (px) around the logo's client dot, with fading opacity. */
const ARCS: ReadonlyArray<{ r: number; opacity: number }> = [
  { r: 44, opacity: 0.16 },
  { r: 72, opacity: 0.12 },
  { r: 110, opacity: 0.09 },
  { r: 160, opacity: 0.065 },
  { r: 224, opacity: 0.045 },
  { r: 300, opacity: 0.03 }
]
const SIZE = 320

const heading = ref<HTMLElement | null>(null)

onMounted(() => {
  const active = document.activeElement
  if (!active || active === document.body) heading.value?.focus({ preventScroll: true })
})
</script>

<template>
  <header class="relative isolate flex flex-col items-start gap-5">
    <div class="relative size-12">
      <!-- Arcs share the logo's origin: its client dot sits at 31% / 69% of the mark. -->
      <svg
        aria-hidden="true"
        class="pointer-events-none absolute bottom-[31%] left-[31%] -z-10 overflow-visible text-foreground"
        :width="SIZE"
        :height="SIZE"
        :viewBox="`0 0 ${SIZE} ${SIZE}`"
        fill="none"
      >
        <path
          v-for="(arc, index) in ARCS"
          :key="arc.r"
          class="welcome-arc"
          :style="{ '--i': index }"
          :d="`M0 ${SIZE - arc.r} A${arc.r} ${arc.r} 0 0 1 ${arc.r} ${SIZE}`"
          stroke="currentColor"
          :stroke-opacity="arc.opacity"
          stroke-width="1.25"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <span aria-hidden="true" class="logo-glow absolute -inset-5 -z-10 rounded-full" />
      <AppLogo class="relative size-12 drop-shadow-sm" />
    </div>

    <div class="space-y-1.5">
      <h1 ref="heading" tabindex="-1" class="text-2xl font-semibold tracking-tight outline-none">
        Welcome to mqtey
      </h1>
      <p class="max-w-md text-sm text-pretty text-muted-foreground">
        Connect to any MQTT broker, watch topics live and publish in seconds.
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button data-testid="welcome-new-connection" @click="ui.openNewConnection()">
        <PlusIcon data-icon="inline-start" />
        New connection
        <KbdShortcut
          :keys="SHORTCUTS.newConnection.keys"
          :platform="platform"
          class="ml-1 *:data-[slot=kbd]:bg-primary-foreground/15 *:data-[slot=kbd]:text-primary-foreground"
        />
      </Button>
      <Button
        variant="outline"
        data-testid="welcome-import"
        :disabled="connections.importing"
        :aria-busy="connections.importing || undefined"
        @click="connections.importFromFile()"
      >
        <Spinner v-if="connections.importing" data-icon="inline-start" />
        <FileUpIcon v-else data-icon="inline-start" />
        Import connections
      </Button>
    </div>
  </header>
</template>

<style scoped>
.logo-glow {
  background: radial-gradient(
    closest-side,
    color-mix(in oklab, var(--primary) 30%, transparent),
    transparent
  );
  filter: blur(6px);
}

.welcome-arc {
  animation: welcome-arc-in 200ms ease-out both;
  animation-delay: calc(var(--i, 0) * 45ms + 60ms);
}

@keyframes welcome-arc-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-arc {
    animation: none;
  }
}
</style>
