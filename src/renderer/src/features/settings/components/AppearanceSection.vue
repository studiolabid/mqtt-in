<script setup lang="ts">
/**
 * Appearance: theme tiles and accent swatches.
 */
import AccentPicker from './AccentPicker.vue'
import SettingsRow from './SettingsRow.vue'
import SettingsSection from './SettingsSection.vue'
import ThemePicker from './ThemePicker.vue'
</script>

<template>
  <SettingsSection id="appearance" title="Appearance" description="Theme and accent color.">
    <SettingsRow
      label="Theme"
      description="Light, dark, or the same as your system."
      layout="stacked"
    >
      <ThemePicker />
    </SettingsRow>
    <SettingsRow
      label="Accent color"
      description="Used for primary buttons, selections and focus rings."
      layout="stacked"
    >
      <AccentPicker />
    </SettingsRow>
  </SettingsSection>
</template>
