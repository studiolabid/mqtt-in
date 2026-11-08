<script setup lang="ts">
/**
 * Logs tab of a connection workspace: toolbar (levels, search, auto-scroll, copy, export,
 * clear) over the virtualized log of the connection, with empty states.
 */
import { computed, ref } from 'vue'
import { BugIcon, FilterXIcon, PlugIcon, ScrollTextIcon } from '@lucide/vue'
import { EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { useHotkey } from '@/composables'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import { formatNumber } from '@/utils/format'
import { LOG_LEVELS } from '@/utils/logs'
import { SHORTCUTS } from '@/utils/shortcuts'
import LogList from './components/LogList.vue'
import LogToolbar from './components/LogToolbar.vue'
import { useLogActions } from './composables/useLogActions'
import { useLogView } from './composables/useLogView'
import { LOG_LEVEL_LABELS } from './utils/log-text'

const props = defineProps<{ connectionId: string }>()

const ui = useUiStore()
const sessions = useSessionsStore()
const { levels, search, autoScroll, entries, rows, counts, filtering, filterKey, resetFilters } =
  useLogView(() => props.connectionId)
const { exporting, copyEntries, exportEntries, clear } = useLogActions(() => props.connectionId)

const toolbar = ref<InstanceType<typeof LogToolbar> | null>(null)
const visible = computed(() => ui.workspaceTab(props.connectionId) === 'logs')
const total = computed(() => entries.value.length)

const status = computed(() => sessions.statusOf(props.connectionId))
const canConnect = computed(() => status.value === 'disconnected' || status.value === 'error')
const debugHidden = computed(() => !levels.value.includes('debug'))

useHotkey(SHORTCUTS.search.combo, () => toolbar.value?.focusSearch(), {
  enabled: visible,
  ignoreInDialogs: true
})

const emptyDescription = computed(() =>
  canConnect.value
    ? 'Connect to see connection events, errors and subscription changes here.'
    : 'Connection events, errors and subscription changes appear here as they happen.'
)

/** Levels that are hidden although they have entries. */
const hiddenLevels = computed(() =>
  LOG_LEVELS.filter((level) => !levels.value.includes(level) && counts.value[level] > 0)
)

/** Why nothing is shown although the log has entries, and the action that fixes it. */
const filteredState = computed(() => {
  if (levels.value.length === 0) {
    return { description: 'Every log level is hidden.', action: 'Show all levels' }
  }
  const term = search.value.trim()
  if (term) {
    const scope = hiddenLevels.value.length > 0 ? ' in the visible levels' : ''
    return { description: `No entry matches “${term}”${scope}.`, action: 'Clear filters' }
  }
  const [only, ...others] = hiddenLevels.value
  if (only && others.length === 0) {
    const count = counts.value[only]
    const name = LOG_LEVEL_LABELS[only].toLowerCase()
    const verb = count === 1 ? 'entry is' : 'entries are'
    return {
      description: `${formatNumber(count)} ${name} ${verb} hidden by the level filter.`,
      action: `Show ${name} entries`
    }
  }
  return { description: 'Every entry is hidden by the level filter.', action: 'Show hidden levels' }
})

function fixFilter(): void {
  if (levels.value.length === 0 || search.value.trim()) resetFilters()
  else levels.value = [...levels.value, ...hiddenLevels.value]
}

function showDebug(): void {
  levels.value = [...levels.value, 'debug']
}
</script>

<template>
  <div data-testid="log-panel" class="@container/logs flex h-full min-h-0 flex-col bg-background">
    <LogToolbar
      ref="toolbar"
      v-model:levels="levels"
      v-model:search="search"
      v-model:auto-scroll="autoScroll"
      :counts="counts"
      :shown="rows.length"
      :total="total"
      :filtering="filtering"
      :exporting="exporting"
      @copy="copyEntries(rows)"
      @export="exportEntries(rows)"
      @clear="clear"
    />

    <LogList
      v-if="rows.length > 0"
      :rows="rows"
      :search="search"
      :follow="autoScroll"
      :visible="visible"
      :filter-key="filterKey"
    />
    <div v-else class="flex min-h-0 flex-1 overflow-y-auto">
      <EmptyState
        v-if="total === 0"
        :icon="ScrollTextIcon"
        title="No log entries yet"
        :description="emptyDescription"
      >
        <Button v-if="canConnect" size="sm" @click="sessions.connect(connectionId)">
          <PlugIcon aria-hidden="true" />
          Connect
        </Button>
        <Button v-if="debugHidden" size="sm" variant="outline" @click="showDebug">
          <BugIcon aria-hidden="true" />
          Include debug entries
        </Button>
      </EmptyState>
      <EmptyState
        v-else
        :icon="FilterXIcon"
        title="No matching entries"
        :description="filteredState.description"
      >
        <Button size="sm" variant="outline" @click="fixFilter">{{ filteredState.action }}</Button>
      </EmptyState>
    </div>
  </div>
</template>
