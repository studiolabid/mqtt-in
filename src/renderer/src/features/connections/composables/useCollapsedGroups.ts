/**
 * Collapsed sidebar groups, remembered per device (localStorage; failures are ignored and
 * the state then simply lasts for the session).
 */
import { shallowRef } from 'vue'
import { readPreference, writePreference } from '@/utils/preferences'

const STORAGE_KEY = 'mqtt-in.sidebar.collapsedGroups'

function read(): Set<string> {
  const stored = readPreference(STORAGE_KEY)
  return new Set(
    Array.isArray(stored) ? stored.filter((name): name is string => typeof name === 'string') : []
  )
}

function write(names: ReadonlySet<string>): void {
  writePreference(STORAGE_KEY, [...names])
}

export interface CollapsedGroups {
  isCollapsed(name: string): boolean
  toggle(name: string): void
  setCollapsed(name: string, collapsed: boolean): void
  /** True when at least one of `names` is collapsed. */
  anyCollapsed(names: readonly string[]): boolean
  collapseAll(names: readonly string[]): void
  expandAll(): void
}

export function useCollapsedGroups(): CollapsedGroups {
  const collapsed = shallowRef<ReadonlySet<string>>(read())

  function commit(next: Set<string>): void {
    collapsed.value = next
    write(next)
  }

  function setCollapsed(name: string, value: boolean): void {
    if (collapsed.value.has(name) === value) return
    const next = new Set(collapsed.value)
    if (value) next.add(name)
    else next.delete(name)
    commit(next)
  }

  return {
    isCollapsed: (name) => collapsed.value.has(name),
    toggle: (name) => setCollapsed(name, !collapsed.value.has(name)),
    setCollapsed,
    anyCollapsed: (names) => names.some((name) => collapsed.value.has(name)),
    collapseAll: (names) => commit(new Set([...collapsed.value, ...names])),
    expandAll: () => commit(new Set())
  }
}
