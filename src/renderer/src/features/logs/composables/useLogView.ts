/**
 * Per-connection log view: level filter, search and auto-scroll, plus the filtered entries.
 *
 * The view state outlives the panel (the workspace is remounted when switching connections):
 * it is kept per connection id in this module until the renderer reloads, and dropped when the
 * connection is deleted (`onConnectionRemoved`, CT-11).
 */
import {
  computed,
  reactive,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
  type WritableComputedRef
} from 'vue'
import type { LogEntry, LogLevel } from '@shared/models'
import { onConnectionRemoved } from '@/stores/connection-lifecycle'
import { useLogsStore } from '@/stores/logs'
import { useSettingsStore } from '@/stores/settings'
import { filterLogEntries, LOG_LEVELS } from '@/utils/logs'

interface LogViewState {
  /** Visible levels (debug is hidden by default). */
  levels: LogLevel[]
  search: string
  /** `null` = follow the global `autoScroll` setting. */
  autoScroll: boolean | null
}

/** Levels shown in a new view. */
export const DEFAULT_LOG_LEVELS: readonly LogLevel[] = ['info', 'warn', 'error']

const states = new Map<string, LogViewState>()
// Registered once for the module's lifetime (never unregistered).
onConnectionRemoved((connectionId) => states.delete(connectionId))

function stateOf(connectionId: string): LogViewState {
  let state = states.get(connectionId)
  if (!state) {
    state = reactive<LogViewState>({
      levels: [...DEFAULT_LOG_LEVELS],
      search: '',
      autoScroll: null
    })
    states.set(connectionId, state)
  }
  return state
}

/** Levels in display order (debug → error), without duplicates or unknown values. */
export function normalizeLevels(levels: readonly unknown[]): LogLevel[] {
  return LOG_LEVELS.filter((level) => levels.includes(level))
}

export interface LogView {
  levels: WritableComputedRef<LogLevel[]>
  search: WritableComputedRef<string>
  /** Stick to the newest entry. */
  autoScroll: WritableComputedRef<boolean>
  /** Every entry of the connection, oldest first. */
  entries: ComputedRef<readonly LogEntry[]>
  /** Entries matching the level filter and the search, oldest first. */
  rows: ComputedRef<readonly LogEntry[]>
  counts: ComputedRef<Record<LogLevel, number>>
  /** True when the level filter or the search hides something. */
  filtering: ComputedRef<boolean>
  /** Changes whenever the filter changes. */
  filterKey: ComputedRef<string>
  /** Shows every level and clears the search. */
  resetFilters(): void
}

export function useLogView(connectionId: MaybeRefOrGetter<string>): LogView {
  const logs = useLogsStore()
  const settings = useSettingsStore()
  const state = computed(() => stateOf(toValue(connectionId)))

  const levels = computed<LogLevel[]>({
    get: () => state.value.levels,
    set: (value) => {
      state.value.levels = normalizeLevels(value)
    }
  })
  const search = computed<string>({
    get: () => state.value.search,
    set: (value) => {
      state.value.search = value
    }
  })
  const autoScroll = computed<boolean>({
    get: () => state.value.autoScroll ?? settings.settings.autoScroll,
    set: (value) => {
      state.value.autoScroll = value
    }
  })

  const entries = computed(() => logs.entries(toValue(connectionId)))
  const counts = computed(() => logs.counts(toValue(connectionId)))
  const allLevels = computed(() => levels.value.length === LOG_LEVELS.length)

  const rows = computed<readonly LogEntry[]>(() => {
    // No level selected shows nothing (filterLogEntries treats an empty list as "all").
    if (levels.value.length === 0) return []
    return filterLogEntries(entries.value, {
      levels: allLevels.value ? undefined : levels.value,
      search: search.value
    })
  })

  const filtering = computed(() => !allLevels.value || search.value.trim() !== '')
  const filterKey = computed(() => `${levels.value.join(',')}|${search.value.trim().toLowerCase()}`)

  function resetFilters(): void {
    state.value.levels = [...LOG_LEVELS]
    state.value.search = ''
  }

  return { levels, search, autoScroll, entries, rows, counts, filtering, filterKey, resetFilters }
}
