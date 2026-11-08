/**
 * Log panel actions: copy / export the visible entries and clear the log. The export toast names
 * the file (not the whole path) and offers 'Show in folder' (UX-20).
 */
import { ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { LogEntry } from '@shared/models'
import { brokerUrl } from '@shared/defaults'
import { useCopy } from '@/composables'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { api, errorMessage } from '@/services/api'
import { fileName, showInFolder } from '@/stores/connection-transfer'
import { useConnectionsStore } from '@/stores/connections'
import { useLogsStore } from '@/stores/logs'
import { useUiStore } from '@/stores/ui'
import { exportFileName } from '@/utils/export'
import { formatNumber } from '@/utils/format'
import { logEntriesToText, logTimestamp } from '../utils/log-text'

export interface LogActions {
  exporting: Ref<boolean>
  copyEntries(entries: readonly LogEntry[]): Promise<void>
  exportEntries(entries: readonly LogEntry[]): Promise<void>
  /** Asks (unless confirmations are off), then removes every entry of the connection. */
  clear(): Promise<void>
}

function entriesLabel(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? 'entry' : 'entries'}`
}

export function useLogActions(connectionId: MaybeRefOrGetter<string>): LogActions {
  const connections = useConnectionsStore()
  const logs = useLogsStore()
  const ui = useUiStore()
  const { copy } = useCopy()
  const exporting = ref(false)

  function connectionName(): string {
    return connections.get(toValue(connectionId))?.name ?? 'Connection'
  }

  function header(count: number): string[] {
    const profile = connections.get(toValue(connectionId))
    const target = profile ? ` (${brokerUrl(profile)})` : ''
    return [
      `mqtey log of ${connectionName()}${target}`,
      `${entriesLabel(count)}, exported ${logTimestamp(Date.now())}`
    ]
  }

  async function copyEntries(entries: readonly LogEntry[]): Promise<void> {
    if (entries.length === 0) return
    const label = entries.length === 1 ? 'log entry' : `${formatNumber(entries.length)} log entries`
    await copy(logEntriesToText(entries), label)
  }

  async function exportEntries(entries: readonly LogEntry[]): Promise<void> {
    if (entries.length === 0 || exporting.value) return
    exporting.value = true
    try {
      const path = await api.dialog.saveFile({
        title: 'Export log',
        defaultPath: exportFileName(`${connectionName()} log`, 'log'),
        filters: [
          { name: 'Log file', extensions: ['log'] },
          { name: 'Text file', extensions: ['txt'] }
        ],
        content: logEntriesToText(entries, header(entries.length))
      })
      if (path) {
        toast.success(`Exported ${entriesLabel(entries.length)}`, {
          description: fileName(path),
          action: { label: 'Show in folder', onClick: () => showInFolder(path) },
          duration: ACTION_TOAST_DURATION
        })
      }
    } catch (err) {
      toast.error('Could not export the log', { description: errorMessage(err) })
    } finally {
      exporting.value = false
    }
  }

  async function clear(): Promise<void> {
    const id = toValue(connectionId)
    const count = logs.entries(id).length
    if (count === 0) return
    const what = count === 1 ? 'the only entry' : `all ${entriesLabel(count)}`
    const confirmed = await ui.confirmDestructive({
      title: 'Clear the log?',
      description: `Removes ${what} of “${connectionName()}”. New events are still logged.`,
      confirmText: 'Clear log'
    })
    if (confirmed) logs.clear(id)
  }

  return { exporting, copyEntries, exportEntries, clear }
}
