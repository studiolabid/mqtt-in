<script setup lang="ts">
import { onMounted } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { flushStartupProblems } from '@/app/notices'
import { useThemeSync } from '@/composables/useThemeSync'
import ConnectionFormDialog from '@/features/connections/ConnectionFormDialog.vue'
import AppShell from '@/features/shell/AppShell.vue'
import CommandPalette from '@/features/shell/CommandPalette.vue'
import ConfirmDialog from '@/features/shell/ConfirmDialog.vue'
import SubscriptionDialog from '@/features/subscriptions/SubscriptionDialog.vue'
import { DEFAULT_TOAST_DURATION, TOASTER_OFFSET, VISIBLE_TOASTS } from '@/lib/toast-options'
import { prefetchWorkspace } from '@/router'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()

useThemeSync()
onMounted(() => {
  // Children (the Toaster) are mounted first, so queued startup problems can be shown now.
  flushStartupProblems()
  prefetchWorkspace()
})
</script>

<template>
  <!-- Tooltips open on hover and keyboard focus only: focus restored by a closing dialog or
       moved by code must not pop a tooltip up. -->
  <TooltipProvider :delay-duration="300" ignore-non-keyboard-focus>
    <AppShell />
    <ConnectionFormDialog />
    <SubscriptionDialog />
    <CommandPalette />
    <ConfirmDialog />
  </TooltipProvider>
  <!-- Bottom left, above the status bar: never over the publish button, the payload tools or
       the primary buttons of dialogs (they sit on the right). -->
  <Toaster
    position="bottom-left"
    :offset="TOASTER_OFFSET"
    :visible-toasts="VISIBLE_TOASTS"
    :duration="DEFAULT_TOAST_DURATION"
    close-button
    :theme="settings.isDark ? 'dark' : 'light'"
  />
</template>
