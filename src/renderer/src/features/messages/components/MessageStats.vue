<script setup lang="ts">
/**
 * Right end of the message toolbar: "matched / total" while a filter is active (the in-memory
 * count itself lives in the Messages tab and the status bar, UX-14) and, when the ring buffer
 * had to evict messages, a "dropped" chip that explains the limit (click opens Settings).
 *
 * While a re-filtering pass over a large buffer runs (`searching`), a small spinner sits before
 * the count ("Searching…" for screen readers and as its title): the count still grows until the
 * pass ends. Its slot exists whenever a filter is active, so a pass never shifts the toolbar
 * (or the search field being typed in).
 */
import { computed } from 'vue'
import { TriangleAlertIcon } from '@lucide/vue'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNavigation, useThrottledValue } from '@/composables'
import { useMessagesStore, useSettingsStore } from '@/stores'
import { formatCompact, formatNumber } from '@/utils/format'

const props = defineProps<{
  connectionId: string
  filterActive: boolean
  matched: number
  total: number
  /** A re-filtering pass is running (shown after a short delay, see `useSearching`). */
  searching?: boolean
}>()

const messages = useMessagesStore()
const settings = useSettingsStore()
const { openSettings } = useNavigation()

const dropped = useThrottledValue(() => messages.stats(props.connectionId).dropped, 500)
const limit = computed(() => formatNumber(settings.settings.maxMessagesPerConnection))

const countTitle = computed(
  () => `${formatNumber(props.matched)} of ${formatNumber(props.total)} messages match the filters`
)
</script>

<template>
  <div class="flex shrink-0 items-center gap-1.5">
    <span
      v-if="filterActive"
      class="inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground"
      :title="searching ? 'Searching…' : undefined"
    >
      <template v-if="searching">
        <Spinner data-testid="messages-searching" class="size-3" aria-hidden="true" />
        <span class="sr-only">Searching…</span>
      </template>
    </span>
    <span
      v-if="filterActive"
      data-testid="messages-match-count"
      class="hidden font-mono text-[11px] text-muted-foreground tabular-nums @3xl/toolbar:inline"
      :title="countTitle"
    >
      <span class="text-foreground">{{ formatCompact(matched) }}</span> /
      {{ formatCompact(total) }}
    </span>
    <Tooltip v-if="dropped > 0">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-warning/10 px-1.5 text-[11px] font-medium text-warning outline-none transition-colors hover:bg-warning/15 focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="`${formatNumber(dropped)} messages dropped`"
          @click="openSettings('messages')"
        >
          <TriangleAlertIcon class="size-3.5" aria-hidden="true" />
          <span class="hidden font-mono tabular-nums @2xl/toolbar:inline"
            >{{ formatCompact(dropped) }} dropped</span
          >
        </button>
      </TooltipTrigger>
      <TooltipContent class="max-w-72 flex-col items-start gap-0.5">
        <span class="font-medium">{{ formatNumber(dropped) }} older messages dropped</span>
        <span>
          Only the newest {{ limit }} messages per connection are kept in memory; older ones are
          dropped as new ones arrive. Click to change the limit in Settings.
        </span>
      </TooltipContent>
    </Tooltip>
  </div>
</template>
