/**
 * App sidebar layout (width + collapsed). One shared state for the shell, the title bar and the
 * command palette, remembered in localStorage.
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { finiteOr, isRecord, readPreference, writePreference } from '@/utils/preferences'

export const SIDEBAR_WIDTH = { min: 208, max: 400, default: 264 } as const

const STORAGE_KEY = 'mqtt-in.shell.sidebar'

interface SidebarState {
  width: number
  collapsed: boolean
}

export interface SidebarLayout {
  width: ComputedRef<number>
  collapsed: ComputedRef<boolean>
  toggle(): void
  setCollapsed(collapsed: boolean): void
  /** Live width while dragging (not persisted). */
  previewWidth(width: number): void
  /** Final width (persisted). */
  commitWidth(width: number): void
  resetWidth(): void
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH.default
  return Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)))
}

function load(): SidebarState {
  const stored = readPreference(STORAGE_KEY)
  if (!isRecord(stored)) return { width: SIDEBAR_WIDTH.default, collapsed: false }
  return {
    width: clampSidebarWidth(finiteOr(stored.width, SIDEBAR_WIDTH.default)),
    collapsed: stored.collapsed === true
  }
}

let shared: Ref<SidebarState> | undefined

function state(): Ref<SidebarState> {
  shared ??= ref(load())
  return shared
}

function persist(): void {
  const { width, collapsed } = state().value
  writePreference(STORAGE_KEY, { width, collapsed })
}

export function useSidebarLayout(): SidebarLayout {
  const current = state()

  function setCollapsed(collapsed: boolean): void {
    if (current.value.collapsed === collapsed) return
    current.value.collapsed = collapsed
    persist()
  }

  return {
    width: computed(() => current.value.width),
    collapsed: computed(() => current.value.collapsed),
    toggle: () => setCollapsed(!current.value.collapsed),
    setCollapsed,
    previewWidth(width) {
      current.value.width = clampSidebarWidth(width)
    },
    commitWidth(width) {
      current.value.width = clampSidebarWidth(width)
      persist()
    },
    resetWidth() {
      current.value.width = SIDEBAR_WIDTH.default
      persist()
    }
  }
}
