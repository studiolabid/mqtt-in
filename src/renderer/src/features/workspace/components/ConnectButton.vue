<script setup lang="ts">
/**
 * The workspace's primary session button: Connect → Connecting… (click cancels) → Disconnect;
 * Reconnecting… (click disconnects); Retry after an error (the error in the tooltip).
 */
import { computed, type Component } from 'vue'
import { PlugIcon, RotateCwIcon, UnplugIcon } from '@lucide/vue'
import { Button, type ButtonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSessionsStore } from '@/stores'

const props = defineProps<{ connectionId: string }>()

const sessions = useSessionsStore()

interface ButtonView {
  label: string
  /** Shown instead of `label` while hovered / focused (what a click does). */
  actionLabel?: string
  icon?: Component
  busy?: boolean
  variant: ButtonVariants['variant']
  tooltip?: string
  disabled?: boolean
}

const status = computed(() => sessions.statusOf(props.connectionId))
const error = computed(() => sessions.get(props.connectionId).error)

const view = computed<ButtonView>(() => {
  switch (status.value) {
    case 'connected':
      return { label: 'Disconnect', icon: UnplugIcon, variant: 'outline' }
    case 'connecting':
      return {
        label: 'Connecting…',
        actionLabel: 'Cancel',
        busy: true,
        variant: 'outline',
        tooltip: 'Cancel the connection attempt'
      }
    case 'reconnecting':
      return {
        label: 'Reconnecting…',
        actionLabel: 'Disconnect',
        busy: true,
        variant: 'outline',
        tooltip: error.value ? `Last error: ${error.value}` : 'Stop reconnecting'
      }
    case 'disconnecting':
      return { label: 'Disconnecting…', busy: true, variant: 'outline', disabled: true }
    case 'error':
      return {
        label: 'Retry',
        icon: RotateCwIcon,
        variant: 'default',
        tooltip: error.value ?? 'The connection failed'
      }
    default:
      return { label: 'Connect', icon: PlugIcon, variant: 'default' }
  }
})

function onClick(): void {
  void sessions.toggle(props.connectionId)
}
</script>

<template>
  <Tooltip :disabled="!view.tooltip">
    <TooltipTrigger as-child>
      <Button
        data-testid="workspace-connect"
        :data-status="status"
        :variant="view.variant"
        :disabled="view.disabled"
        :aria-busy="view.busy || undefined"
        class="min-w-28 @3xl/header:min-w-[8.75rem]"
        @click="onClick"
      >
        <Spinner v-if="view.busy" data-icon="inline-start" class="size-3.5" />
        <component :is="view.icon" v-else-if="view.icon" data-icon="inline-start" />
        <template v-if="view.actionLabel">
          <span class="group-hover/button:hidden group-focus-visible/button:hidden">
            {{ view.label }}
          </span>
          <span class="hidden group-hover/button:inline group-focus-visible/button:inline">
            {{ view.actionLabel }}
          </span>
        </template>
        <span v-else>{{ view.label }}</span>
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom" align="end" class="max-w-80 wrap-anywhere">
      {{ view.tooltip }}
    </TooltipContent>
  </Tooltip>
</template>
