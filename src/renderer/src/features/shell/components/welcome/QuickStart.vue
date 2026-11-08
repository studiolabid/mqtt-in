<script setup lang="ts">
/**
 * Quick start cards: the broker presets plus "your own broker" (a blank connection).
 */
import { SlidersHorizontalIcon } from '@lucide/vue'
import { useUiStore } from '@/stores'
import { BROKER_PRESETS } from '@/utils/presets'
import { presetIcon } from '../../utils/presets'
import QuickStartCard from './QuickStartCard.vue'

const ui = useUiStore()
</script>

<template>
  <section aria-labelledby="welcome-quick-start" class="@container min-w-0">
    <h2 id="welcome-quick-start" class="mb-2.5 text-xs font-medium text-muted-foreground">
      Quick start
    </h2>
    <div class="grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3">
      <QuickStartCard
        v-for="preset in BROKER_PRESETS"
        :key="preset.id"
        :data-testid="`preset-${preset.id}`"
        :title="preset.title"
        :description="preset.description"
        :address="preset.address"
        :icon="presetIcon(preset)"
        @click="ui.openNewConnection(preset.profile)"
      />
      <QuickStartCard
        data-testid="welcome-custom-connection"
        title="Your own broker"
        description="Host, port, TLS, authentication — configure everything yourself."
        address="mqtt · mqtts · ws · wss"
        :icon="SlidersHorizontalIcon"
        dashed
        @click="ui.openNewConnection()"
      />
    </div>
  </section>
</template>
