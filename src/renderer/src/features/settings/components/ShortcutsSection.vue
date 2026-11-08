<script setup lang="ts">
/**
 * Keyboard shortcuts (read-only, from the shortcut registry), grouped, two columns when wide.
 */
import { KbdShortcut } from '@/components/common'
import { hostPlatform } from '@/composables'
import { shortcutsByGroup, SHORTCUTS } from '@/utils/shortcuts'
import SettingsSection from './SettingsSection.vue'

const groups = shortcutsByGroup()
const platform = hostPlatform()
</script>

<template>
  <SettingsSection
    id="shortcuts"
    title="Keyboard shortcuts"
    description="Work without leaving the keyboard."
    class="grid gap-px divide-y-0 bg-border @2xl/settings:grid-cols-2"
  >
    <div
      v-for="(group, index) in groups"
      :key="group.group"
      :class="[
        'bg-card',
        // An odd last group fills the row instead of leaving an empty (border colored) cell.
        groups.length % 2 === 1 && index === groups.length - 1 && '@2xl/settings:col-span-2'
      ]"
    >
      <h3
        class="px-4 pt-3 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
      >
        {{ group.group }}
      </h3>
      <dl class="pb-1.5">
        <div
          v-for="shortcut in group.items"
          :key="shortcut.combo"
          class="flex min-h-9 items-center justify-between gap-4 px-4 py-1.5"
        >
          <dt class="min-w-0 truncate text-[13px]" :title="shortcut.label">{{ shortcut.label }}</dt>
          <dd class="shrink-0">
            <KbdShortcut :keys="shortcut.keys" :platform="platform" />
          </dd>
        </div>
      </dl>
    </div>
    <p
      class="flex flex-wrap items-center gap-x-1.5 gap-y-1 bg-card px-4 py-3 text-xs text-muted-foreground @2xl/settings:col-span-2"
    >
      Every action is also available from the command palette
      <KbdShortcut :keys="SHORTCUTS.commandPalette.keys" :platform="platform" />
    </p>
  </SettingsSection>
</template>
