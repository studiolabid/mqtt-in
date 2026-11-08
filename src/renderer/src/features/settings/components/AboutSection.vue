<script setup lang="ts">
/**
 * About: logo, name and version, runtime versions (copyable for bug reports) and credits.
 */
import { computed } from 'vue'
import { ClipboardCopyIcon } from '@lucide/vue'
import { APP_NAME } from '@shared/defaults'
import { AppLogo, PoweredBy } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppInfo, useCopy } from '@/composables'
import { api } from '@/services/api'
import SettingsSection from './SettingsSection.vue'
import { platformName } from '../utils/options'

const { info, loading, error, reload } = useAppInfo()
const { copy } = useCopy()

const DETAIL_LABELS = ['Electron', 'Chrome', 'Node.js', 'V8', 'Platform', 'Architecture'] as const

const CREDITS = [
  { name: 'Electron', url: 'https://www.electronjs.org' },
  { name: 'Vue', url: 'https://vuejs.org' },
  { name: 'shadcn-vue', url: 'https://www.shadcn-vue.com' },
  { name: 'MQTT.js', url: 'https://github.com/mqttjs/MQTT.js' }
] as const

const details = computed(() => {
  const value = info.value
  if (!value) return []
  const values = [
    value.versions.electron,
    value.versions.chrome,
    value.versions.node,
    value.versions.v8,
    platformName(value.platform),
    value.arch
  ]
  return DETAIL_LABELS.map((label, index) => ({ label, value: values[index] }))
})

function copyDetails(): void {
  const value = info.value
  if (!value) return
  const text = [
    `${value.name} ${value.version}`,
    ...details.value.map((detail) => `${detail.label}: ${detail.value}`)
  ].join('\n')
  void copy(text, 'version details')
}

function open(url: string): void {
  api.app.openExternal(url).catch((err: unknown) => {
    console.warn('[mqtey] could not open', url, err)
  })
}
</script>

<template>
  <SettingsSection id="about" title="About">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
      <AppLogo class="size-11" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h3 class="text-base font-semibold tracking-tight">{{ info?.name ?? APP_NAME }}</h3>
          <Skeleton v-if="loading" class="h-5 w-12 rounded-full" />
          <Badge v-else-if="info" variant="secondary" class="font-mono tabular-nums select-text">
            v{{ info.version }}
          </Badge>
        </div>
        <p class="mt-0.5 text-[13px] text-muted-foreground">
          A fast, calm MQTT client for the desktop.
        </p>
        <PoweredBy class="mt-1" />
      </div>
      <Button v-if="info" variant="outline" size="sm" @click="copyDetails">
        <ClipboardCopyIcon aria-hidden="true" />
        Copy details
      </Button>
    </div>

    <p v-if="error && !info" class="flex items-center gap-3 px-4 py-3 text-[13px]">
      <span class="min-w-0 flex-1 text-muted-foreground">
        Could not read the version information. {{ error }}
      </span>
      <Button variant="outline" size="sm" @click="reload">Retry</Button>
    </p>
    <dl v-else class="grid grid-cols-2 gap-px bg-border @lg/settings:grid-cols-3">
      <template v-if="info">
        <div v-for="detail in details" :key="detail.label" class="min-w-0 bg-card px-4 py-2.5">
          <dt class="text-xs text-muted-foreground">{{ detail.label }}</dt>
          <dd class="truncate font-mono text-[13px] tabular-nums select-text" :title="detail.value">
            {{ detail.value }}
          </dd>
        </div>
      </template>
      <template v-else>
        <div v-for="label in DETAIL_LABELS" :key="label" class="bg-card px-4 py-2.5">
          <dt class="text-xs text-muted-foreground">{{ label }}</dt>
          <dd><Skeleton class="my-0.5 h-4 w-20" /></dd>
        </div>
      </template>
    </dl>

    <p class="px-4 py-3 text-xs text-muted-foreground">
      Built with
      <template v-for="(credit, index) in CREDITS" :key="credit.name">
        <span v-if="index > 0">{{ index === CREDITS.length - 1 ? ' and ' : ', ' }}</span>
        <button
          type="button"
          class="rounded-sm underline-offset-2 transition-colors outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          @click="open(credit.url)"
        >
          {{ credit.name }}
        </button>
      </template>
      <span>.</span>
    </p>
  </SettingsSection>
</template>
