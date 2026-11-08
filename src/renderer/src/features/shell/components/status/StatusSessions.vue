<script setup lang="ts">
/**
 * Status bar: overview of the active sessions (mini status dots + counts). The tooltip lists
 * them; clicking opens the command palette (connect, disconnect, open).
 */
import { computed } from 'vue'
import { StatusDot } from '@/components/common'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useConnectionsStore, useSessionsStore, useUiStore } from '@/stores'
import { statusLabel } from '@/utils/connection'
import { sessionSummaryParts, sessionSummaryText, summarizeSessions } from '../../utils/sessions'

/** Dots drawn before the rest is summarized as `+N`. */
const MAX_DOTS = 5

const ui = useUiStore()
const connections = useConnectionsStore()
const sessions = useSessionsStore()

const summary = computed(() => summarizeSessions(connections.profiles, sessions.statusOf))
const dots = computed(() => summary.value.active.slice(0, MAX_DOTS))
const overflow = computed(() => Math.max(0, summary.value.active.length - MAX_DOTS))
const parts = computed(() => sessionSummaryParts(summary.value))
const text = computed(() => sessionSummaryText(summary.value))
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        class="flex h-5 min-w-0 items-center gap-1.5 rounded-md px-1.5 transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="`${text}. Open the command palette`"
        @click="ui.commandPaletteOpen = true"
      >
        <span v-if="dots.length > 0" class="flex items-center gap-1" aria-hidden="true">
          <StatusDot
            v-for="session in dots"
            :key="session.connectionId"
            :status="session.status"
            size="xs"
          />
          <span v-if="overflow > 0" class="font-mono text-[10px] tabular-nums"
            >+{{ overflow }}</span
          >
        </span>
        <StatusDot v-else status="disconnected" size="xs" aria-hidden="true" />
        <span class="truncate">
          <template v-if="parts.length === 0">{{ text }}</template>
          <template v-for="(part, index) in parts" :key="part.kind">
            <span v-if="index > 0"> · </span>
            <span :class="part.kind === 'failed' && 'text-destructive'">{{ part.text }}</span>
          </template>
        </span>
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" align="start" class="block max-w-72 px-2.5 py-2">
      <p v-if="summary.active.length === 0">No connection is active</p>
      <ul v-else class="space-y-1">
        <li
          v-for="session in summary.active"
          :key="session.connectionId"
          class="flex min-w-0 items-center gap-2"
        >
          <StatusDot :status="session.status" size="xs" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ session.name }}</span>
          <span class="shrink-0 opacity-70">{{ statusLabel(session.status) }}</span>
        </li>
      </ul>
    </TooltipContent>
  </Tooltip>
</template>
