<script setup lang="ts">
/**
 * Message buffer size: a number field (Enter / blur commits, arrows step by 1,000) with quick
 * presets. Values are clamped to `LIMITS.maxMessagesPerConnection`.
 */
import { nextTick, ref, watch } from 'vue'
import { LIMITS } from '@shared/defaults'
import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput
} from '@/components/ui/number-field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useSettingsStore } from '@/stores/settings'
import { formatNumber } from '@/utils/format'
import { useSettingsSaver } from '../composables/useSettingsSaver'
import { MAX_MESSAGE_PRESETS } from '../utils/options'

defineProps<{
  /** Id of the input (for the row label). */
  id?: string
}>()

const { min, max } = LIMITS.maxMessagesPerConnection
const FORMAT: Intl.NumberFormatOptions = { useGrouping: true, maximumFractionDigits: 0 }

const settings = useSettingsStore()
const { save } = useSettingsSaver()

/** Local copy of the value, so an emptied field can be restored. */
const draft = ref<number | undefined>(settings.settings.maxMessagesPerConnection)

watch(
  () => settings.settings.maxMessagesPerConnection,
  (value) => {
    draft.value = value
  }
)

function onInput(value: number | undefined): void {
  if (value === undefined || !Number.isFinite(value)) {
    // Emptied field: show the current value again (a round trip through `undefined` makes the
    // field re-render its text).
    draft.value = undefined
    void nextTick(() => {
      draft.value = settings.settings.maxMessagesPerConnection
    })
    return
  }
  draft.value = value
  void save({ maxMessagesPerConnection: value })
}

function onPreset(value: unknown): void {
  const preset = MAX_MESSAGE_PRESETS.find((option) => String(option.value) === value)
  if (!preset) return
  draft.value = preset.value
  void save({ maxMessagesPerConnection: preset.value })
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <NumberField
      :id="id"
      :model-value="draft"
      :min="min"
      :max="max"
      :step="1000"
      :step-snapping="false"
      :format-options="FORMAT"
      class="w-36"
      @update:model-value="onInput"
    >
      <NumberFieldContent>
        <NumberFieldDecrement class="text-muted-foreground hover:text-foreground" />
        <NumberFieldInput
          data-testid="settings-max-messages"
          :aria-label="`Messages kept per connection (${formatNumber(min)} to ${formatNumber(max)})`"
          class="font-mono tabular-nums"
        />
        <NumberFieldIncrement class="text-muted-foreground hover:text-foreground" />
      </NumberFieldContent>
    </NumberField>
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      :model-value="String(draft ?? '')"
      aria-label="Presets"
      @update:model-value="onPreset"
    >
      <ToggleGroupItem
        v-for="preset in MAX_MESSAGE_PRESETS"
        :key="preset.value"
        :value="String(preset.value)"
        :aria-label="`${formatNumber(preset.value)} messages`"
        class="font-mono text-xs tabular-nums"
      >
        {{ preset.label }}
      </ToggleGroupItem>
    </ToggleGroup>
  </div>
</template>
