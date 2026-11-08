<script setup lang="ts">
/**
 * Empty state of the sidebar (no saved connection).
 *
 * `minimal` (the welcome screen is shown, with New connection, Import and the quick start
 * presets): only "No connections yet" and one line, so the first screen offers each entry point
 * once (UX-15). Elsewhere (e.g. the settings page): New connection and a short preset list. The
 * header's New and Import buttons stay in both cases.
 */
import { computed } from 'vue'
import { ArrowRightIcon, PlusIcon, RadioTowerIcon } from '@lucide/vue'
import { NEUTRAL_COLOR } from '@shared/defaults'
import { ConnectionAvatar, EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui'
import { BROKER_PRESETS, type BrokerPreset } from '@/utils/presets'

defineProps<{ minimal: boolean }>()

const ui = useUiStore()

/**
 * One preset per broker host (the WebSocket variant of the same broker is skipped), each with
 * the avatar color the new connection will get.
 */
const presets = computed<Array<{ preset: BrokerPreset; color: string }>>(() => {
  const hosts = new Set<string>()
  return BROKER_PRESETS.filter((preset) => {
    const host = preset.profile.host ?? preset.id
    if (hosts.has(host)) return false
    hosts.add(host)
    return true
  }).map((preset) => ({ preset, color: preset.profile.color ?? NEUTRAL_COLOR }))
})

function start(preset: BrokerPreset, color: string): void {
  ui.openNewConnection({ ...preset.profile, color })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-slim">
    <EmptyState
      v-if="minimal"
      compact
      data-testid="sidebar-empty"
      :icon="RadioTowerIcon"
      title="No connections yet"
      description="Your saved brokers will be listed here."
      class="flex-none pt-8 pb-5"
    />
    <EmptyState
      v-else
      compact
      data-testid="sidebar-empty"
      :icon="RadioTowerIcon"
      title="No connections yet"
      description="Add your broker or try a public test broker."
      class="flex-none pt-8 pb-5"
    >
      <Button size="sm" @click="ui.openNewConnection()">
        <PlusIcon aria-hidden="true" />
        New connection
      </Button>
    </EmptyState>
    <section v-if="!minimal" aria-labelledby="sidebar-quick-start" class="px-2 pb-3">
      <h3 id="sidebar-quick-start" class="px-2 pb-1 text-xs font-medium text-muted-foreground">
        Quick start
      </h3>
      <ul class="flex flex-col gap-0.5">
        <li v-for="{ preset, color } in presets" :key="preset.id">
          <button
            type="button"
            class="group/preset flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors outline-none hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
            :title="preset.description"
            @click="start(preset, color)"
          >
            <ConnectionAvatar :name="preset.title" :color="color" size="sm" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-[13px] leading-tight font-medium">{{ preset.title }}</span>
              <span class="truncate font-mono text-[11px] leading-tight text-muted-foreground">
                {{ preset.address }}
              </span>
            </span>
            <ArrowRightIcon
              class="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/preset:opacity-100 group-focus-visible/preset:opacity-100"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
