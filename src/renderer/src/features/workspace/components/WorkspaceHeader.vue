<script setup lang="ts">
/**
 * Workspace header (h-12): connection identity (avatar with live status, name, the protocol
 * badge that opens the "Broker" popover, broker URL), the last error while it matters, and the
 * session / edit / more actions. Live counters and rates live in the status bar only (one home
 * per number, UX-14).
 *
 * When the workspace opens after a navigation that removed the focused element (Settings Back,
 * the palette), keyboard focus starts on the connection name heading (A11Y-11).
 */
import { computed, onMounted, ref } from 'vue'
import { LockIcon, PencilIcon } from '@lucide/vue'
import type { ConnectionProfile } from '@shared/models'
import { isMqttProfile } from '@shared/connection-kind'
import { brokerUrl, isTlsProtocol } from '@shared/defaults'
import { ConnectionAvatar, KbdShortcut } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hostPlatform } from '@/composables'
import { useSessionsStore, useUiStore } from '@/stores'
import { profileTypeLabel } from '@/utils/connection'
import { SHORTCUTS } from '@/utils/shortcuts'
import BrokerInfoPopover from './BrokerInfoPopover.vue'
import ConnectButton from './ConnectButton.vue'
import ConnectionErrorHint from './ConnectionErrorHint.vue'
import WorkspaceMenu from './WorkspaceMenu.vue'

const props = defineProps<{ profile: ConnectionProfile }>()

const sessions = useSessionsStore()
const ui = useUiStore()
const platform = hostPlatform()
const heading = ref<HTMLElement | null>(null)

onMounted(() => {
  const active = document.activeElement
  if (!active || active === document.body) heading.value?.focus({ preventScroll: true })
})

const session = computed(() => sessions.get(props.profile.id))
const status = computed(() => session.value.status)
const url = computed(() => brokerUrl(props.profile))
const tls = computed(() => isTlsProtocol(props.profile.protocol))
const mqtt = computed(() => isMqttProfile(props.profile))

/** The last error, while it matters (failed, or retrying after a failure). */
const hint = computed(() => {
  const error = session.value.error
  if (!error) return null
  if (status.value === 'error') return { error, tone: 'destructive' as const }
  if (status.value === 'reconnecting') return { error, tone: 'warning' as const }
  return null
})

function retry(): void {
  void sessions.connect(props.profile.id)
}
</script>

<template>
  <header class="@container/header flex h-12 shrink-0 items-center gap-3 border-b px-3">
    <div class="flex min-w-0 flex-1 items-center gap-2.5">
      <span class="relative flex shrink-0">
        <Transition
          enter-active-class="transition-opacity duration-200"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-200"
          leave-to-class="opacity-0"
        >
          <span
            v-if="status === 'connected'"
            aria-hidden="true"
            class="pointer-events-none absolute inset-0"
          >
            <span class="connected-glow" />
          </span>
        </Transition>
        <ConnectionAvatar
          :name="profile.name"
          :color="profile.color"
          :status="status"
          size="md"
          class="relative"
        />
      </span>
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-1.5">
          <h1
            ref="heading"
            tabindex="-1"
            class="truncate text-sm leading-5 font-semibold outline-none"
            :title="profile.name"
          >
            {{ profile.name }}
          </h1>
          <BrokerInfoPopover v-if="mqtt" :profile="profile" />
          <span
            v-else
            data-testid="connection-kind-badge"
            class="inline-flex h-[18px] shrink-0 items-center rounded-md border px-1.5 font-mono text-[10px] text-muted-foreground"
          >
            {{ profileTypeLabel(profile) }}
          </span>
        </div>
        <div class="flex min-w-0 items-center gap-1 text-muted-foreground">
          <LockIcon
            v-if="tls"
            class="size-3 shrink-0 text-success"
            role="img"
            aria-label="TLS encrypted"
          />
          <span class="truncate font-mono text-[11px] leading-4 select-text" :title="url">
            {{ url }}
          </span>
        </div>
      </div>
    </div>

    <ConnectionErrorHint
      v-if="hint"
      :error="hint.error"
      :tone="hint.tone"
      class="hidden @lg/header:flex"
      @retry="retry"
      @edit="ui.openEditConnection(profile.id)"
    />

    <div class="flex shrink-0 items-center gap-1">
      <ConnectButton :connection-id="profile.id" />
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            data-testid="workspace-edit"
            variant="ghost"
            size="icon"
            class="text-muted-foreground"
            aria-label="Edit connection"
            :aria-keyshortcuts="platform === 'darwin' ? 'Meta+E' : 'Control+E'"
            @click="ui.openEditConnection(profile.id)"
          >
            <PencilIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Edit connection
          <KbdShortcut :keys="SHORTCUTS.editConnection.keys" :platform="platform" />
        </TooltipContent>
      </Tooltip>
      <WorkspaceMenu :connection-id="profile.id" />
    </div>
  </header>
</template>

<style scoped>
/* Soft "alive" halo behind the avatar while connected. */
.connected-glow {
  position: absolute;
  inset: -4px;
  border-radius: 0.875rem;
  background: color-mix(in oklab, var(--success) 32%, transparent);
  filter: blur(9px);
  opacity: 0.6;
  pointer-events: none;
}
</style>
