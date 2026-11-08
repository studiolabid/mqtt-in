<script setup lang="ts">
/**
 * Accent color picker: eight named swatches showing each accent's primary color in the current
 * mode (a radio group; arrows move between swatches). Applies instantly. The swatches come from
 * the same table as the applied theme tokens (`@/lib/accents`), Mono (black and white) first.
 */
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { CheckIcon } from '@lucide/vue'
import { useSettingsStore } from '@/stores/settings'
import { useSettingsSaver } from '../composables/useSettingsSaver'
import { ACCENT_OPTIONS, accentSwatchStyle, isAccentColor } from '../utils/options'

const settings = useSettingsStore()
const { save } = useSettingsSaver()

function select(value: unknown): void {
  if (isAccentColor(value)) void save({ accent: value })
}
</script>

<template>
  <RadioGroupRoot
    :model-value="settings.settings.accent"
    orientation="horizontal"
    aria-label="Accent color"
    class="grid w-full max-w-[34rem] grid-cols-4 gap-1 @lg/settings:grid-cols-8"
    @update:model-value="select"
  >
    <RadioGroupItem
      v-for="swatch in ACCENT_OPTIONS"
      :key="swatch.value"
      :value="swatch.value"
      :data-testid="`settings-accent-${swatch.value}`"
      :style="accentSwatchStyle(swatch, settings.isDark)"
      class="group/swatch flex min-w-0 flex-col items-center gap-2 rounded-lg px-1 pt-2.5 pb-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        class="swatch grid size-7 place-items-center rounded-full transition-[box-shadow,scale] duration-150 group-hover/swatch:scale-105"
      >
        <CheckIcon
          class="size-3.5 scale-50 opacity-0 transition duration-150 group-data-[state=checked]/swatch:scale-100 group-data-[state=checked]/swatch:opacity-100"
          :stroke-width="3"
          aria-hidden="true"
        />
      </span>
      <span
        class="max-w-full truncate text-xs text-muted-foreground transition-colors group-data-[state=checked]/swatch:font-medium group-data-[state=checked]/swatch:text-foreground"
      >
        {{ swatch.label }}
      </span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>

<style scoped>
.swatch {
  background-color: var(--swatch);
  color: var(--swatch-foreground);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--foreground) 12%, transparent);
}
[data-state='checked'] > .swatch {
  box-shadow:
    0 0 0 2px var(--card),
    0 0 0 3.5px var(--swatch);
}
</style>
