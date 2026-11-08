<script setup lang="ts">
/**
 * Theme picker: System / Light / Dark as preview tiles (a radio group; arrows move between
 * tiles). Applies instantly.
 */
import { computed } from 'vue'
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { CheckIcon } from '@lucide/vue'
import { usePreferredDark } from '@vueuse/core'
import type { ThemeMode } from '@shared/models'
import { hostPlatform } from '@/composables'
import { useSettingsStore } from '@/stores/settings'
import ThemePreview from './ThemePreview.vue'
import { useSettingsSaver } from '../composables/useSettingsSaver'
import { platformName, THEME_OPTIONS } from '../utils/options'

const settings = useSettingsStore()
const { save } = useSettingsSaver()
const preferredDark = usePreferredDark()

const systemHint = computed(
  () => `Follows ${platformName(hostPlatform())} · ${preferredDark.value ? 'dark' : 'light'} now`
)

function isTheme(value: unknown): value is ThemeMode {
  return THEME_OPTIONS.some((option) => option.value === value)
}

function select(value: unknown): void {
  if (isTheme(value)) void save({ theme: value })
}
</script>

<template>
  <RadioGroupRoot
    :model-value="settings.settings.theme"
    orientation="horizontal"
    aria-label="Theme"
    class="grid w-full max-w-[34rem] grid-cols-3 gap-3"
    @update:model-value="select"
  >
    <RadioGroupItem
      v-for="option in THEME_OPTIONS"
      :key="option.value"
      :value="option.value"
      :data-testid="`settings-theme-${option.value}`"
      class="group/tile flex min-w-0 flex-col gap-2 rounded-lg text-left outline-none"
    >
      <span
        class="relative block aspect-[16/10] w-full overflow-hidden rounded-lg border shadow-xs transition-[border-color,box-shadow] duration-150 group-hover/tile:border-ring/70 group-focus-visible/tile:outline-2 group-focus-visible/tile:outline-offset-2 group-focus-visible/tile:outline-ring group-data-[state=checked]/tile:border-primary group-data-[state=checked]/tile:ring-3 group-data-[state=checked]/tile:ring-primary/20"
      >
        <ThemePreview v-if="option.value !== 'dark'" variant="light" />
        <ThemePreview
          v-if="option.value !== 'light'"
          variant="dark"
          :split="option.value === 'system'"
        />
        <span
          class="absolute top-1.5 right-1.5 grid size-4 scale-75 place-items-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-sm transition duration-150 group-data-[state=checked]/tile:scale-100 group-data-[state=checked]/tile:opacity-100"
        >
          <CheckIcon class="size-2.5" :stroke-width="3.5" aria-hidden="true" />
        </span>
      </span>
      <span class="flex min-w-0 flex-col px-0.5">
        <span class="flex items-center gap-1.5 text-[13px] font-medium">
          <component
            :is="option.icon"
            class="size-3.5 shrink-0 text-muted-foreground transition-colors group-data-[state=checked]/tile:text-primary-text"
            aria-hidden="true"
          />
          {{ option.label }}
        </span>
        <span
          v-if="option.value === 'system'"
          class="truncate text-xs text-muted-foreground"
          :title="systemHint"
        >
          {{ systemHint }}
        </span>
      </span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
