<script setup lang="ts">
/**
 * Topic tree toolbar (h-10): search, paused indicator, topic count, expand / collapse all.
 */
import { computed, ref } from 'vue'
import { ChevronsDownUpIcon, ChevronsUpDownIcon, PauseIcon } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { SearchInput } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCompact, formatNumber } from '@/utils/format'
import { SHORTCUTS } from '@/utils/shortcuts'

const props = defineProps<{
  topicCount: number
  /** Matching topics while searching, `null` otherwise. */
  matchCount: number | null
  paused: boolean
  /** Expand / collapse apply to the unfiltered tree only. */
  searching: boolean
}>()

const search = defineModel<string>('search', { required: true })

const emit = defineEmits<{
  expandAll: []
  collapseAll: []
  resume: []
  /** ArrowDown in the search field: continue in the tree. */
  enterTree: []
}>()

const root = ref<HTMLElement | null>(null)
const searchInput = ref<InstanceType<typeof SearchInput> | null>(null)
const { width } = useElementSize(root)

/** The shortcut hint only fits next to the placeholder in a wide enough toolbar. */
const showHint = computed(() => width.value >= 300)
const count = computed(() => props.matchCount ?? props.topicCount)
const countTitle = computed(() =>
  props.matchCount === null
    ? `${formatNumber(props.topicCount)} ${props.topicCount === 1 ? 'topic' : 'topics'}`
    : `${formatNumber(props.matchCount)} of ${formatNumber(props.topicCount)} topics match`
)

defineExpose({
  /** Focuses the search field. */
  focusSearch: (): void => searchInput.value?.focus()
})
</script>

<template>
  <div ref="root" class="flex h-10 shrink-0 items-center gap-1 border-b pr-2 pl-3">
    <div class="min-w-0 flex-1" @keydown.down.prevent="emit('enterTree')">
      <SearchInput
        ref="searchInput"
        v-model="search"
        data-testid="topic-search"
        size="sm"
        placeholder="Filter topics…"
        :shortcut="showHint ? SHORTCUTS.search.keys : undefined"
      />
    </div>

    <Tooltip v-if="paused">
      <TooltipTrigger as-child>
        <Button
          variant="ghost"
          size="xs"
          class="shrink-0 text-warning hover:text-warning"
          @click="emit('resume')"
        >
          <PauseIcon aria-hidden="true" />
          <span v-if="width >= 280">Paused</span>
          <span v-else class="sr-only">Paused</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Live updates are paused. Click to resume.</TooltipContent>
    </Tooltip>

    <span
      v-if="width >= 220"
      :title="countTitle"
      class="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-muted px-1.5 font-mono text-[11px] leading-none text-muted-foreground tabular-nums"
    >
      {{ formatCompact(count) }}
    </span>

    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-muted-foreground"
          aria-label="Expand all"
          :disabled="searching"
          @click="emit('expandAll')"
        >
          <ChevronsUpDownIcon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Expand all</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-muted-foreground"
          aria-label="Collapse all"
          :disabled="searching"
          @click="emit('collapseAll')"
        >
          <ChevronsDownUpIcon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Collapse all</TooltipContent>
    </Tooltip>
  </div>
</template>
