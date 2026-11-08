<script setup lang="ts">
/**
 * A settings row with a switch bound to a boolean setting (applies instantly; the label
 * toggles it too).
 */
import { computed, useId } from 'vue'
import type { AppSettings } from '@shared/models'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settings'
import SettingsRow from './SettingsRow.vue'
import { useSettingsSaver } from '../composables/useSettingsSaver'

type BooleanSetting = {
  [K in keyof AppSettings]: AppSettings[K] extends boolean ? K : never
}[keyof AppSettings]

const props = defineProps<{
  setting: BooleanSetting
  label: string
  description?: string
}>()

const settings = useSettingsStore()
const { save } = useSettingsSaver()
const id = useId()

const checked = computed(() => settings.settings[props.setting])

function onChange(value: boolean): void {
  void save({ [props.setting]: value })
}
</script>

<template>
  <SettingsRow :label="label" :description="description" :for="id" layout="inline">
    <Switch :id="id" :model-value="checked" @update:model-value="onChange" />
  </SettingsRow>
</template>
