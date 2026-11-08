/**
 * Entries of the command palette (re-exported by `usePaletteCommands`).
 */
import type { Component } from 'vue'
import type { ConnectionProfile, ConnectionStatus } from '@shared/models'

export interface PaletteCommand {
  /** Unique id, also the listbox value (stable: tests and docs refer to it). */
  id: string
  label: string
  icon: Component
  /** Shortcut hint (from the `SHORTCUTS` registry). */
  keys?: readonly string[]
  /** Muted trailing text, e.g. a broker address, or why a disabled entry cannot run. */
  hint?: string
  /** Extra search terms (not displayed). */
  keywords?: string
  disabled?: boolean
  run(): unknown
}

export interface PaletteConnection {
  profile: ConnectionProfile
  url: string
  status: ConnectionStatus
  current: boolean
  /** Connect / disconnect / retry entry of the session. */
  session: PaletteCommand
}
