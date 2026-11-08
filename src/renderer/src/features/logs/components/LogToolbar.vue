<script setup lang="ts">
/**
 * Log toolbar (h-10): level filter with counts, search, auto-scroll, copy, export and clear.
 * The auto-scroll toggle keeps one name; its state is `aria-pressed` (A11Y-23).
 */
import { ref } from 'vue'
import { ArrowDownToLineIcon, CopyIcon, DownloadIcon, Trash2Icon } from '@lucide/vue'
import type { LogLevel } from '@shared/models'
import { IconButton, SearchInput } from '@/components/common'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { formatCompact, formatNumber } from '@/utils/format'
import { SHORTCUTS } from '@/utils/shortcuts'
import LogLevelFilter from './LogLevelFilter.vue'

defineProps<{
  counts: Record<LogLevel, number>
  /** Entries shown with the current filter. */
  shown: number
  /** Every entry of the connection. */
  total: number
  filtering: boolean
  exporting: boolean
}>()

const emit = defineEmits<{ copy: []; export: []; clear: [] }>()

const levels = defineModel<LogLevel[]>('levels', { required: true })
const search = defineModel<string>('search', { required: true })
const autoScroll = defineModel<boolean>('autoScroll', { required: true })

const searchInput = ref<InstanceType<typeof SearchInput> | null>(null)

defineExpose({
  /** Focuses the search field. */
  focusSearch: (): void => searchInput.value?.focus()
})
</script>

<template>
  <div class="flex h-10 shrink-0 items-center gap-2 border-b pr-2 pl-3">
    <LogLevelFilter v-model="levels" :counts="counts" />
    <SearchInput
      ref="searchInput"
      v-model="search"
      size="sm"
      placeholder="Filter log"
      :shortcut="SHORTCUTS.search.keys"
      class="w-auto max-w-64 min-w-20 flex-1"
    />
    <span
      v-if="filtering && total > 0"
      class="hidden shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums @xl/logs:inline"
      :title="`${formatNumber(shown)} of ${formatNumber(total)} entries shown`"
    >
      {{ formatCompact(shown) }}/{{ formatCompact(total) }}
    </span>

    <div class="ml-auto flex shrink-0 items-center gap-0.5">
      <IconButton
        label="Auto-scroll"
        :aria-pressed="autoScroll"
        :class="cn(autoScroll && 'bg-muted text-foreground dark:bg-muted/70')"
        @click="autoScroll = !autoScroll"
      >
        <ArrowDownToLineIcon aria-hidden="true" />
      </IconButton>
      <IconButton label="Copy visible entries" :disabled="shown === 0" @click="emit('copy')">
        <CopyIcon aria-hidden="true" />
      </IconButton>
      <IconButton
        label="Export visible entries…"
        :disabled="shown === 0 || exporting"
        @click="emit('export')"
      >
        <Spinner v-if="exporting" />
        <DownloadIcon v-else aria-hidden="true" />
      </IconButton>
      <Separator orientation="vertical" class="mx-1 h-4 data-[orientation=vertical]:self-center" />
      <IconButton
        label="Clear log"
        data-testid="logs-clear"
        :disabled="total === 0"
        class="hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
        @click="emit('clear')"
      >
        <Trash2Icon aria-hidden="true" />
      </IconButton>
    </div>
  </div>
</template>
