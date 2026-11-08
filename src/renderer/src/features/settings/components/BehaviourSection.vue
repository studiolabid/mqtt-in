<script setup lang="ts">
/**
 * Behaviour: confirmation of destructive actions.
 */
import SettingSwitchRow from './SettingSwitchRow.vue'
import SettingsSection from './SettingsSection.vue'
</script>

<template>
  <SettingsSection id="behaviour" title="Behaviour" description="Safety nets for everyday work.">
    <SettingSwitchRow
      setting="confirmBeforeDelete"
      label="Confirm before deleting"
      description="Ask before deleting connections or subscriptions and before clearing messages or logs."
    />
  </SettingsSection>
</template>
