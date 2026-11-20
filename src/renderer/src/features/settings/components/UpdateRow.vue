<script setup lang="ts">
/**
 * Settings › About: the self-update status with its action — check for updates, the download
 * progress, "Restart & update" once a newer version is ready, or a link to the GitHub releases
 * when this build cannot update itself.
 */
import { computed } from 'vue'
import { DownloadIcon, ExternalLinkIcon, RefreshCwIcon, RotateCwIcon } from '@lucide/vue'
import { releaseUrl } from '@shared/defaults'
import { RelativeTime } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/services/api'
import { useUpdateStore } from '@/stores'
import SettingsRow from './SettingsRow.vue'

const update = useUpdateStore()
const state = computed(() => update.state)

const title = computed(() => {
  const value = state.value
  switch (value.phase) {
    case 'unsupported':
      return 'Automatic updates are not available'
    case 'checking':
      return 'Checking for updates…'
    case 'up-to-date':
      return 'mqtt-in is up to date'
    case 'downloading':
      return `Downloading version ${value.version ?? ''}`
    case 'ready':
      return `Version ${value.version ?? ''} is ready to install`
    case 'error':
      return 'The last update check failed'
    default:
      return 'Updates'
  }
})

const description = computed(() => {
  const value = state.value
  switch (value.phase) {
    case 'unsupported':
    case 'error':
      return value.message
    case 'ready':
      return 'Restart to update. Your connections, settings and history stay as they are.'
    case 'downloading':
      return 'Downloading in the background; you can keep working.'
    case 'idle':
      return 'New versions come from the GitHub releases.'
    default:
      return undefined
  }
})

function openNotes(): void {
  const version = state.value.version
  if (!version) return
  api.app.openExternal(releaseUrl(version)).catch((err: unknown) => {
    console.warn('[mqtt-in] could not open the release notes', err)
  })
}
</script>

<template>
  <SettingsRow :label="title" data-testid="update-row">
    <template #description>
      <template v-if="description">{{ description }}</template>
      <template v-if="state.checkedAt && state.phase === 'up-to-date'">
        Checked <RelativeTime :timestamp="state.checkedAt" />.
      </template>
      <Progress
        v-if="state.phase === 'downloading'"
        :model-value="state.percent ?? 0"
        class="mt-2 h-1.5 max-w-64"
        :aria-label="`Download ${state.percent ?? 0}%`"
      />
    </template>

    <template v-if="state.phase === 'ready'">
      <Button variant="outline" size="sm" @click="openNotes">
        <ExternalLinkIcon aria-hidden="true" />
        What's new
      </Button>
      <Button
        size="sm"
        data-testid="update-install"
        :disabled="update.installing"
        @click="update.install()"
      >
        <Spinner v-if="update.installing" />
        <RotateCwIcon v-else aria-hidden="true" />
        Restart &amp; update
      </Button>
    </template>
    <span
      v-else-if="state.phase === 'downloading'"
      class="font-mono text-[13px] text-muted-foreground tabular-nums"
    >
      {{ state.percent ?? 0 }}%
    </span>
    <Button
      v-else-if="state.phase === 'unsupported'"
      variant="outline"
      size="sm"
      @click="update.openReleases()"
    >
      <DownloadIcon aria-hidden="true" />
      Open releases
    </Button>
    <Button
      v-else
      variant="outline"
      size="sm"
      data-testid="update-check"
      :disabled="update.checking"
      @click="update.check()"
    >
      <Spinner v-if="update.checking" />
      <RefreshCwIcon v-else aria-hidden="true" />
      Check for updates
    </Button>
  </SettingsRow>
</template>
