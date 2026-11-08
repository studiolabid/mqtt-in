/**
 * Connection use cases shared by the sidebar, the workspace header, the message toolbar and the
 * command palette: open, connect / disconnect, edit, duplicate, export, copy the broker URL,
 * clear messages and delete. Destructive actions confirm first (unless disabled in the
 * settings); store actions toast their own failures.
 *
 * Must be called from a component `setup` (uses the router).
 */
import { toast } from 'vue-sonner'
import { brokerUrl } from '@shared/defaults'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { useConnectionsStore } from '@/stores/connections'
import { useMessagesStore } from '@/stores/messages'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import { formatCount } from '@/utils/format'
import { useCopy } from './useCopy'
import { useNavigation } from './useNavigation'

export interface ConnectionActions {
  /** Opens the workspace of the connection. */
  open(id: string): void
  /** Connects / disconnects (cancels a connect attempt in progress). */
  toggle(id: string): void
  edit(id: string): void
  /** Duplicates the profile; the toast offers to edit the copy. */
  duplicate(id: string): Promise<void>
  exportProfile(id: string): Promise<void>
  copyBrokerUrl(id: string): Promise<void>
  /** Clears the message buffer, topic tree and statistics (and the selected message). */
  clearMessages(id: string): Promise<void>
  /** Deletes the profile (disconnecting it first). */
  remove(id: string): Promise<void>
}

export function useConnectionActions(): ConnectionActions {
  const connections = useConnectionsStore()
  const sessions = useSessionsStore()
  const messages = useMessagesStore()
  const ui = useUiStore()
  const navigation = useNavigation()
  const { copy } = useCopy()

  const nameOf = (id: string): string => connections.get(id)?.name ?? 'this connection'

  async function duplicate(id: string): Promise<void> {
    const created = await connections.duplicate(id)
    if (!created) return
    toast.success(`Duplicated as “${created.name}”`, {
      action: { label: 'Edit', onClick: () => ui.openEditConnection(created.id) },
      duration: ACTION_TOAST_DURATION
    })
  }

  async function copyBrokerUrl(id: string): Promise<void> {
    const profile = connections.get(id)
    if (profile) await copy(brokerUrl(profile), 'broker URL')
  }

  async function clearMessages(id: string): Promise<void> {
    const count = messages.count(id)
    if (count === 0) {
      toast.info('There are no messages to clear')
      return
    }
    const confirmed = await ui.confirmDestructive({
      title: 'Clear messages?',
      description: `${formatCount(count, 'message')} of ${nameOf(id)} are removed from memory, together with the topic tree and the statistics. Retained messages stay on the broker.`,
      confirmText: 'Clear messages'
    })
    if (!confirmed) return
    ui.selectMessage(id, null)
    messages.clear(id)
  }

  async function remove(id: string): Promise<void> {
    if (!connections.get(id)) return
    const name = nameOf(id)
    const consequences = 'Its subscriptions, messages and publish history are removed as well.'
    const confirmed = await ui.confirmDestructive({
      title: `Delete “${name}”?`,
      description: `${sessions.isActive(id) ? 'It will be disconnected first. ' : ''}${consequences} This cannot be undone.`,
      confirmText: 'Delete connection'
    })
    if (!confirmed) return
    // The app navigates home by itself once the open profile is gone.
    if (await connections.remove(id)) toast.success(`Deleted “${name}”`)
  }

  return {
    open: (id) => void navigation.openConnection(id),
    toggle: (id) => void sessions.toggle(id),
    edit: (id) => ui.openEditConnection(id),
    duplicate,
    exportProfile: async (id) => {
      await connections.exportToFile([id])
    },
    copyBrokerUrl,
    clearMessages,
    remove
  }
}
