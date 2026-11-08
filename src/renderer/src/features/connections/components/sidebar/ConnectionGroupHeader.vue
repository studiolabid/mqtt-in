<script setup lang="ts">
/**
 * Collapsible group header (must sit inside a `Collapsible`): chevron, name, connection count
 * and, while collapsed, a status dot when connections inside are live.
 */
import { ChevronRightIcon } from '@lucide/vue'
import { StatusDot } from '@/components/common'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

defineProps<{
  name: string
  count: number
  /** Connected sessions in the group. */
  connected: number
  open: boolean
  /** False while searching (groups are forced open). */
  collapsible: boolean
  /** Contains the open connection. */
  current: boolean
  /** Reachable with Tab (when no item is). */
  tabStop: boolean
}>()
</script>

<template>
  <CollapsibleTrigger as-child>
    <button
      type="button"
      data-nav
      data-group-header
      :data-group="name"
      :tabindex="tabStop ? 0 : -1"
      :class="
        cn(
          'flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset disabled:cursor-default disabled:hover:bg-transparent',
          current && !open && 'text-sidebar-foreground'
        )
      "
    >
      <ChevronRightIcon
        :class="
          cn(
            'size-3.5 shrink-0 transition-transform duration-150',
            open && 'rotate-90',
            !collapsible && 'opacity-40'
          )
        "
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1 truncate text-left" :title="name">{{ name }}</span>
      <StatusDot
        v-if="!open && connected > 0"
        status="connected"
        size="xs"
        :title="`${connected} connected`"
      />
      <span class="shrink-0 font-mono text-[11px] tabular-nums">{{ count }}</span>
    </button>
  </CollapsibleTrigger>
</template>
