<script setup lang="ts">
/**
 * Messages: buffer size, default payload view, timestamp format (with a live example),
 * milliseconds, auto-scroll and word wrap.
 */
import { computed, useId } from 'vue'
import { useNow } from '@vueuse/core'
import { LIMITS } from '@shared/defaults'
import { VIEW_FORMATS } from '@shared/payload'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useFormatters } from '@/composables'
import { useSettingsStore } from '@/stores/settings'
import { formatNumber } from '@/utils/format'
import MaxMessagesField from './MaxMessagesField.vue'
import SettingSwitchRow from './SettingSwitchRow.vue'
import SettingsRow from './SettingsRow.vue'
import SettingsSection from './SettingsSection.vue'
import { useSettingsSaver } from '../composables/useSettingsSaver'
import { TIMESTAMP_OPTIONS } from '../utils/options'

const settings = useSettingsStore()
const { save } = useSettingsSaver()
const fmt = useFormatters()
const now = useNow({ interval: 1000 })
const maxId = useId()

const { min, max } = LIMITS.maxMessagesPerConnection

/** A message that arrived just before the page opened (makes "relative" tick). */
const sampleTimestamp = Date.now() - 4_000

/** Ticks every second: the clock for absolute formats, the age for `relative`. */
const timestampExample = computed(() => {
  const current = now.value.getTime()
  return fmt.time(settings.settings.timestampFormat === 'relative' ? sampleTimestamp : current)
})

function onViewFormat(value: unknown): void {
  const format = VIEW_FORMATS.find((option) => option.value === value)
  if (format) void save({ defaultViewFormat: format.value })
}

function onTimestampFormat(value: unknown): void {
  const option = TIMESTAMP_OPTIONS.find((item) => item.value === value)
  if (option) void save({ timestampFormat: option.value })
}
</script>

<template>
  <SettingsSection id="messages" title="Messages" description="How messages are kept and shown.">
    <SettingsRow label="Messages kept per connection" :for="maxId">
      <template #description>
        The oldest messages are dropped beyond this limit ({{ formatNumber(min) }} –
        {{ formatNumber(max) }}). Larger buffers use more memory.
      </template>
      <MaxMessagesField :id="maxId" />
    </SettingsRow>

    <SettingsRow
      label="Default payload view"
      description="How payloads are decoded when a workspace opens. Each connection can still switch."
    >
      <Select :model-value="settings.settings.defaultViewFormat" @update:model-value="onViewFormat">
        <SelectTrigger class="w-40" aria-label="Default payload view">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="format in VIEW_FORMATS" :key="format.value" :value="format.value">
            {{ format.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>

    <SettingsRow label="Timestamps">
      <template #description>
        Time of messages in lists, e.g.
        <span class="font-mono text-foreground tabular-nums">{{ timestampExample }}</span>
      </template>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        :model-value="settings.settings.timestampFormat"
        aria-label="Timestamp format"
        @update:model-value="onTimestampFormat"
      >
        <ToggleGroupItem
          v-for="option in TIMESTAMP_OPTIONS"
          :key="option.value"
          :value="option.value"
          class="px-2.5"
        >
          {{ option.label }}
        </ToggleGroupItem>
      </ToggleGroup>
    </SettingsRow>

    <SettingSwitchRow
      setting="showMilliseconds"
      label="Show milliseconds"
      description="Adds milliseconds to message and log times."
    />
    <SettingSwitchRow
      setting="autoScroll"
      label="Auto-scroll"
      description="Keep message and log lists at the newest entry while you are at the bottom."
    />
    <SettingSwitchRow
      setting="wordWrap"
      label="Wrap long payloads"
      description="Wrap payload text in lists and viewers instead of cutting it off."
    />
  </SettingsSection>
</template>
