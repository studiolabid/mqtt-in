/**
 * Import / export of connection files: the use cases behind
 * `useConnectionsStore().importFromFile` / `exportToFile` (CT-10), their shared busy state
 * (`importing` / `exporting`: every entry point — sidebar, welcome screen, Settings, palette —
 * sees the same one) and the pure builders of their toasts. Internal helper of the connections
 * store.
 */
import { computed, ref, shallowRef, type ComputedRef } from 'vue'
import { toast } from 'vue-sonner'
import type {
  ConnectionProfile,
  ExportConnectionsOptions,
  ImportConnectionsResult
} from '@shared/models'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { api, errorMessage } from '@/services/api'
import { formatCount } from '@/utils/format'

/** Skipped entries listed by the main process at most (`ImportConnectionsResult.skipped`). */
export const IMPORT_SKIPS_LISTED = 20

export interface TransferToast {
  kind: 'success' | 'info' | 'warning'
  title: string
  description?: string
}

/** Last segment of a path (`C:\a\b.json` → `b.json`, `/a/b.json` → `b.json`). */
export function fileName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function skippedPart(result: ImportConnectionsResult): string | null {
  const count = result.skipped.length
  if (count === 0) return null
  // The list is capped: at the cap there may have been more.
  const label = count >= IMPORT_SKIPS_LISTED ? `${count}+` : String(count)
  return `${label} skipped (${result.skipped[0].reason})`
}

function tlsPart(cleared: number): string | null {
  if (cleared <= 0) return null
  return cleared === 1
    ? '1 needs its certificate files selected again'
    : `${cleared} need their certificate files selected again`
}

function join(parts: ReadonlyArray<string | null>): string | undefined {
  const present = parts.filter((part): part is string => part !== null)
  return present.length > 0 ? present.join(' · ') : undefined
}

/**
 * The toast for an import outcome (CT-04), e.g. 'Imported 2 connections' with
 * '1 skipped (port: Too big…) · 6 already present · 2 need their certificate files selected
 * again'.
 */
export function importToast(result: ImportConnectionsResult): TransferToast {
  const imported = result.imported.length
  const skipped = skippedPart(result)
  const duplicates = result.duplicates > 0 ? `${result.duplicates} already present` : null
  if (imported > 0) {
    const from = result.source === 'mqttx' ? ' from MQTTX' : ''
    return {
      kind: 'success',
      title: `Imported ${formatCount(imported, 'connection')}${from}`,
      description: join([skipped, duplicates, tlsPart(result.tlsPathsCleared)])
    }
  }
  if (result.duplicates > 0 && !skipped) {
    return {
      kind: 'info',
      title:
        result.duplicates === 1
          ? 'This connection is already present'
          : `All ${result.duplicates} connections are already present`
    }
  }
  if (skipped) {
    return {
      kind: 'warning',
      title: 'No connections imported',
      description: join([duplicates, skipped])
    }
  }
  return { kind: 'info', title: 'The file contains no connections' }
}

/** Whether the profiles hold a password or a TLS key passphrase. */
export function hasSecrets(profiles: readonly ConnectionProfile[]): boolean {
  return profiles.some((profile) => profile.password !== '' || profile.tls.passphrase !== '')
}

/**
 * The toast for a written export: 'Exported 6 connections' with the file name and whether
 * passwords were written ('· passwords not included' / '· includes passwords in plain text';
 * nothing when no profile has one).
 */
export function exportToast(
  path: string,
  profiles: readonly ConnectionProfile[],
  includeSecrets: boolean
): TransferToast {
  const secrets = hasSecrets(profiles)
    ? includeSecrets
      ? 'includes passwords in plain text'
      : 'passwords not included'
    : null
  return {
    kind: 'success',
    title: `Exported ${formatCount(profiles.length, 'connection')}`,
    description: join([fileName(path), secrets])
  }
}

/** What the transfer use cases need from the connections store. */
export interface TransferDeps {
  get(id: string): ConnectionProfile | undefined
  all(): readonly ConnectionProfile[]
  /** Adopts a stored (imported) profile locally. */
  adopt(profile: ConnectionProfile): void
}

export interface ConnectionTransfer {
  /** True while an import runs (from its file dialog until the outcome toast). */
  importing: ComputedRef<boolean>
  /** True while an export runs (from its file dialog until the outcome toast). */
  exporting: ComputedRef<boolean>
  /**
   * Imports profiles from a file chosen by the user (they get fresh ids and are saved by the
   * main process). Toasts the outcome (CT-04): skipped entries with the first reason, entries
   * already present, profiles whose certificate files must be picked again. A call while an
   * import runs joins it (no second file dialog).
   *
   * @returns the number of imported profiles (0 when cancelled or failed).
   */
  importFromFile(): Promise<number>
  /**
   * Exports the given profiles (all when omitted) to a file chosen by the user. Passwords and
   * passphrases are written only with `options.includeSecrets` (default: left out). The toast
   * names the file (not the whole path), says whether passwords were included and offers
   * 'Show in folder'. One export at a time: a call while one runs resolves null at once.
   *
   * @returns the written path, or null when cancelled, failed (after a toast) or busy.
   */
  exportToFile(ids?: readonly string[], options?: ExportConnectionsOptions): Promise<string | null>
}

/** Shows a transfer toast; one with an action stays `ACTION_TOAST_DURATION`. */
function showToast(content: TransferToast, action?: { label: string; onClick: () => void }): void {
  toast[content.kind](
    content.title,
    action
      ? { description: content.description, action, duration: ACTION_TOAST_DURATION }
      : { description: content.description }
  )
}

/** Reveals a written file in the OS file manager (a toast when it cannot). */
export function showInFolder(path: string): void {
  api.app.showItemInFolder(path).catch((err: unknown) => {
    toast.error('Could not show the file', { description: errorMessage(err) })
  })
}

export function createConnectionTransfer(deps: TransferDeps): ConnectionTransfer {
  /** The running import (joined by later calls) and whether an export runs. */
  const runningImport = shallowRef<Promise<number> | null>(null)
  const exportRunning = ref(false)

  function importFromFile(): Promise<number> {
    if (runningImport.value) return runningImport.value
    const run = runImport().finally(() => {
      runningImport.value = null
    })
    runningImport.value = run
    return run
  }

  async function runImport(): Promise<number> {
    try {
      const result = await api.connections.importFromFile()
      if (!result) return 0
      for (const profile of result.imported) deps.adopt(profile)
      showToast(importToast(result))
      return result.imported.length
    } catch (err) {
      toast.error('Import failed', { description: errorMessage(err) })
      return 0
    }
  }

  async function exportToFile(
    ids?: readonly string[],
    options?: ExportConnectionsOptions
  ): Promise<string | null> {
    if (exportRunning.value) return null
    exportRunning.value = true
    try {
      const path = await api.connections.exportToFile(ids ? [...ids] : undefined, options)
      if (path) {
        const exported = ids
          ? ids.flatMap((id) => {
              const profile = deps.get(id)
              return profile ? [profile] : []
            })
          : deps.all()
        showToast(exportToast(path, exported, options?.includeSecrets === true), {
          label: 'Show in folder',
          onClick: () => showInFolder(path)
        })
      }
      return path
    } catch (err) {
      toast.error('Export failed', { description: errorMessage(err) })
      return null
    } finally {
      exportRunning.value = false
    }
  }

  return {
    importing: computed(() => runningImport.value !== null),
    exporting: computed(() => exportRunning.value),
    importFromFile,
    exportToFile
  }
}
