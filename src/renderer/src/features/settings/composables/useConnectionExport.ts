/**
 * "Export all…" of Settings > Data (SEC-10, UX-13). Exports leave passwords and TLS key
 * passphrases out unless the user ticks "Include passwords and passphrases (plain text)" for
 * this one export: the choice is reset after every attempt (also a cancelled one), so a later
 * export never carries secrets by accident. `exporting` is the store's busy state, shared by
 * every export entry point (sidebar, palette, connection menus; RC-22).
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useConnectionsStore } from '@/stores/connections'

export interface ConnectionExport {
  /** Write passwords and passphrases into the next export (plain text). */
  includeSecrets: Ref<boolean>
  /** An export runs (from here or any other entry point). */
  exporting: ComputedRef<boolean>
  /**
   * Exports every connection; resolves to the written path, or null (cancelled, failed, or
   * another export is running).
   */
  exportAll(): Promise<string | null>
}

export function useConnectionExport(): ConnectionExport {
  const connections = useConnectionsStore()
  const includeSecrets = ref(false)

  async function exportAll(): Promise<string | null> {
    if (connections.exporting) return null
    try {
      return await connections.exportToFile(undefined, { includeSecrets: includeSecrets.value })
    } finally {
      includeSecrets.value = false
    }
  }

  return { includeSecrets, exporting: computed(() => connections.exporting), exportAll }
}
