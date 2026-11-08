/**
 * Exports messages to a JSON or CSV file through the native save dialog.
 *
 * The success toast names the file only (not the whole path) and offers "Show in folder"
 * (`api.app.showItemInFolder`, CT-02), for `ACTION_TOAST_DURATION` (UX-20, CT-30).
 * `useExportRequests` runs an export when another part of the app asks for one through
 * `ui.requestMessageExport(id, format)` (the command palette, CT-17).
 */
import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { FileFilter, MqttMessage } from '@shared/models'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { api, errorMessage } from '@/services/api'
import { useConnectionsStore, useUiStore } from '@/stores'
import { fileName, showInFolder } from '@/stores/connection-transfer'
import type { MessageExportFormat } from '@/types'
import { exportFileName, messagesToCsv, messagesToJson } from '@/utils/export'
import { formatCount } from '@/utils/format'

export type ExportKind = MessageExportFormat

const FILTERS: Readonly<Record<ExportKind, FileFilter>> = {
  json: { name: 'JSON', extensions: ['json'] },
  csv: { name: 'CSV', extensions: ['csv'] }
}

export interface MessageExport {
  busy: Ref<boolean>
  exportMessages(kind: ExportKind, messages: readonly MqttMessage[]): Promise<void>
}

/** Resolves after the next paint, so a spinner shows before synchronous serialization. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

/** The success toast: 'Exported 25 messages', the file name and a 'Show in folder' action. */
export function exportedToast(path: string, count: number): void {
  toast.success(`Exported ${formatCount(count, 'message')}`, {
    description: fileName(path),
    duration: ACTION_TOAST_DURATION,
    action: { label: 'Show in folder', onClick: () => showInFolder(path) }
  })
}

export function useMessageExport(connectionId: MaybeRefOrGetter<string>): MessageExport {
  const connections = useConnectionsStore()
  const ui = useUiStore()
  const busy = ref(false)

  async function exportMessages(kind: ExportKind, messages: readonly MqttMessage[]): Promise<void> {
    if (busy.value) return
    if (messages.length === 0) {
      toast.info('There are no messages to export')
      return
    }
    busy.value = true
    try {
      await afterPaint()
      const id = toValue(connectionId)
      const format = ui.viewFormat(id)
      const content =
        kind === 'json'
          ? messagesToJson(messages, format)
          : messagesToCsv(messages, format, { bom: true })
      const name = connections.get(id)?.name ?? 'mqtey'
      const path = await api.dialog.saveFile({
        title: 'Export messages',
        defaultPath: exportFileName(name, kind),
        filters: [FILTERS[kind]],
        content
      })
      if (path) exportedToast(path, messages.length)
    } catch (err) {
      toast.error('Export failed', { description: errorMessage(err) })
    } finally {
      busy.value = false
    }
  }

  return { busy, exportMessages }
}

/**
 * Calls `run(format)` once for every export request made after this call (`seq` bumps):
 * requests made before (e.g. while another workspace was shown) are not replayed.
 */
export function useExportRequests(
  connectionId: MaybeRefOrGetter<string>,
  run: (format: ExportKind) => void
): void {
  const ui = useUiStore()
  let handled = ui.messageExportRequest(toValue(connectionId))?.seq ?? 0
  watch(
    () => toValue(connectionId),
    (id) => {
      handled = ui.messageExportRequest(id)?.seq ?? 0
    }
  )
  watch(
    () => ui.messageExportRequest(toValue(connectionId)),
    (request) => {
      if (!request || request.seq <= handled) return
      handled = request.seq
      run(request.format)
    }
  )
}
