<script setup lang="ts">
/**
 * Data: import / export connections, data folder, password encryption status and a reset of
 * every setting. Exports leave passwords out unless "Include passwords and passphrases" is ticked
 * for that one export (`useConnectionExport`). Import and export show the store's busy state,
 * shared by every entry point (RC-22).
 */
import { computed, ref, useId } from 'vue'
import { toast } from 'vue-sonner'
import {
  FileDownIcon,
  FileUpIcon,
  FolderIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon
} from '@lucide/vue'
import type { AppSettings } from '@shared/models'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { CopyButton } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useAppInfo } from '@/composables'
import { useConnectionsStore } from '@/stores/connections'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { formatNumber } from '@/utils/format'
import { useConnectionExport } from '../composables/useConnectionExport'
import SettingsRow from './SettingsRow.vue'
import SettingsSection from './SettingsSection.vue'

const connections = useConnectionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
const { info, loading, error, reload } = useAppInfo()

const { includeSecrets, exporting, exportAll } = useConnectionExport()
const secretsId = useId()

function setIncludeSecrets(value: boolean | 'indeterminate'): void {
  includeSecrets.value = value === true
}
const resetting = ref(false)

const count = computed(() => connections.profiles.length)
const connectionsDescription = computed(() => {
  const saved =
    count.value === 0
      ? 'No saved connections yet.'
      : `${formatNumber(count.value)} saved connection${count.value === 1 ? '' : 's'}.`
  return `${saved} Move them between computers with a JSON file. Exports do not include passwords unless you choose to.`
})

const isDefault = computed(() =>
  (Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]).every(
    (key) => settings.settings[key] === DEFAULT_SETTINGS[key]
  )
)

const encryptionDescription = computed(() => {
  if (!info.value) return 'Whether passwords are encrypted before they are written to disk.'
  return info.value.encryptionAvailable
    ? 'Passwords and TLS passphrases are encrypted with the secure storage of your system before they are written to disk.'
    : 'This system offers no secure storage, so passwords and TLS passphrases are saved as plain text in the data folder.'
})

async function resetSettings(): Promise<void> {
  const confirmed = await ui.confirmDestructive({
    title: 'Reset all settings?',
    description:
      'Theme, accent and message preferences return to their defaults. Connections, subscriptions and publish history are kept.',
    confirmText: 'Reset settings'
  })
  if (!confirmed) return
  resetting.value = true
  try {
    if (await settings.resetToDefaults()) toast.success('Settings restored to their defaults')
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <SettingsSection
    id="data"
    title="Data"
    description="Your connections and where mqtey keeps them."
  >
    <SettingsRow label="Connections" :description="connectionsDescription" layout="stacked">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="settings-import-connections"
            :disabled="connections.importing"
            :aria-busy="connections.importing || undefined"
            @click="connections.importFromFile()"
          >
            <Spinner v-if="connections.importing" class="size-3.5" />
            <FileUpIcon v-else aria-hidden="true" />
            Import…
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="settings-export-connections"
            :disabled="exporting || count === 0"
            :aria-busy="exporting || undefined"
            @click="exportAll"
          >
            <Spinner v-if="exporting" class="size-3.5" />
            <FileDownIcon v-else aria-hidden="true" />
            Export all…
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <Checkbox
            :id="secretsId"
            :model-value="includeSecrets"
            data-testid="export-include-secrets"
            :disabled="exporting || count === 0"
            @update:model-value="setIncludeSecrets"
          />
          <label :for="secretsId" class="text-[13px] leading-5 text-muted-foreground">
            Include passwords and passphrases (plain text)
          </label>
        </div>
      </div>
    </SettingsRow>

    <SettingsRow
      label="Data folder"
      description="Connections, settings and publish history are stored here."
      layout="stacked"
    >
      <div
        class="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border bg-muted/40 pr-1 pl-2.5 dark:bg-input/30"
      >
        <FolderIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Skeleton v-if="loading" class="h-3 w-2/3" />
        <span
          v-else-if="info"
          class="min-w-0 flex-1 truncate font-mono text-xs select-text"
          :title="info.userDataPath"
        >
          {{ info.userDataPath }}
        </span>
        <span
          v-else
          class="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          :title="error ?? ''"
        >
          Could not read the app information.
        </span>
        <CopyButton v-if="info" :value="info.userDataPath" label="data folder path" />
        <Button v-else-if="!loading" variant="ghost" size="xs" @click="reload">Retry</Button>
      </div>
    </SettingsRow>

    <SettingsRow label="Password encryption" :description="encryptionDescription" layout="inline">
      <Skeleton v-if="loading" class="h-5 w-24 rounded-full" />
      <Badge
        v-else-if="info?.encryptionAvailable"
        variant="outline"
        class="border-success/30 bg-success/10 text-success"
      >
        <ShieldCheckIcon aria-hidden="true" />
        Encrypted
      </Badge>
      <Badge
        v-else-if="info"
        variant="outline"
        class="border-warning/30 bg-warning/10 text-warning"
      >
        <ShieldAlertIcon aria-hidden="true" />
        Not available
      </Badge>
    </SettingsRow>

    <SettingsRow
      label="Reset settings"
      :description="
        isDefault
          ? 'Every setting has its default value.'
          : 'Restore the default theme, accent and message preferences. Connections are kept.'
      "
    >
      <Button
        variant="destructive"
        size="sm"
        :disabled="isDefault || resetting"
        @click="resetSettings"
      >
        <Spinner v-if="resetting" class="size-3.5" />
        <RotateCcwIcon v-else aria-hidden="true" />
        Reset to defaults
      </Button>
    </SettingsRow>
  </SettingsSection>
</template>
