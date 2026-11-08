/**
 * Problems the user must hear about at startup and later: renderer startup failures and the
 * storage notices of the main process (CT-01: unreadable or corrupt files, restored backups,
 * skipped entries, failed writes, undecryptable passwords).
 *
 * vue-sonner drops toasts created before a Toaster subscribes, so everything reported before
 * `App.vue` is mounted is queued and shown by `flushStartupProblems`.
 */
import { toast } from 'vue-sonner'
import type { StorageNotice } from '@shared/models'
import { STICKY_TOAST_DURATION } from '@/lib/toast-options'
import { api, errorMessage } from '@/services/api'

const queue: Array<() => void> = []
let mounted = false
/** `kind|file|timestamp` of the storage notices already shown (fetched and pushed ones overlap). */
const shownNotices = new Set<string>()

function whenMounted(show: () => void): void {
  if (mounted) show()
  else queue.push(show)
}

/** Shows a startup problem as an error toast (queued until the app is mounted). */
export function reportStartupProblem(title: string, description?: string): void {
  whenMounted(() => toast.error(title, { description }))
}

/** What a storage file holds, for the toast titles. */
const SUBJECTS: Readonly<Record<string, string>> = {
  'connections.json': 'Saved connections',
  'settings.json': 'Settings',
  'storage.json': 'Publish history and drafts',
  'window-state.json': 'The window layout'
}

const INVALID_ENTRIES: Readonly<Record<string, string>> = {
  'connections.json': 'Some saved connections were invalid',
  'settings.json': 'Some settings were invalid',
  'storage.json': 'Some saved publish entries were invalid'
}

/** Toast title of a storage notice, e.g. 'Saved connections could not be read'. */
export function storageNoticeTitle(notice: Pick<StorageNotice, 'kind' | 'file'>): string {
  const subject = SUBJECTS[notice.file] ?? notice.file
  switch (notice.kind) {
    case 'unreadable':
    case 'corrupt':
      return `${subject} could not be read`
    case 'restored-backup':
      return `${subject} restored from backup`
    case 'invalid-entries':
      return INVALID_ENTRIES[notice.file] ?? `Some entries of ${notice.file} were invalid`
    case 'write-failed':
      return 'Changes could not be saved'
    case 'secrets-unavailable':
      return 'Saved passwords cannot be decrypted'
  }
}

/** Reveals a file of a notice in the OS file manager (a toast when it cannot). */
function showFile(path: string): void {
  api.app.showItemInFolder(path).catch((err: unknown) => {
    toast.error('Could not show the file', { description: errorMessage(err) })
  })
}

/**
 * Shows a storage notice until it is dismissed: `warning` for the notices collected at startup,
 * `error` for later ones (a failed write). The description is the notice's message; a notice
 * with a path offers 'Show file'. A notice is shown once; a newer one of the same kind and file
 * replaces the toast instead of stacking up.
 */
export function reportStorageNotice(notice: StorageNotice, level: 'warning' | 'error'): void {
  const key = `${notice.kind}|${notice.file}|${notice.timestamp}`
  if (shownNotices.has(key)) return
  shownNotices.add(key)
  const path = notice.path
  whenMounted(() =>
    toast[level](storageNoticeTitle(notice), {
      id: `storage-notice:${notice.kind}:${notice.file}`,
      description: notice.message,
      duration: STICKY_TOAST_DURATION,
      action: path ? { label: 'Show file', onClick: () => showFile(path) } : undefined
    })
  )
}

/** Called once the Toaster is mounted: shows (and clears) the queued problems. */
export function flushStartupProblems(): void {
  mounted = true
  for (const show of queue.splice(0)) show()
}
