/**
 * "Copy as command" for publish history entries (FP-4): the entry is prepared exactly as a
 * publish would send it (templates rendered once, payload encoded, MQTT 5 properties for MQTT 5
 * connections) and handed to `@/utils/cli-command` with the connection's profile. Items the
 * generator cannot express are disabled with its reason.
 *
 * One menu model with the messages' "Copy as command": `commandMenuItems` and `copiedToast`
 * from `@/utils/cli-command` (the toast names the password variable and the shell caveat).
 */
import { toast } from 'vue-sonner'
import type { ConnectionProfile } from '@shared/models'
// The helper itself, not the components barrel (which loads every SFC).
import { copyText } from '@/components/common/lib/clipboard'
import { api } from '@/services/api'
import { useConnectionsStore } from '@/stores'
import type { PublishHistoryItem } from '@/types'
import {
  commandMenuItems,
  copiedToast,
  defaultCliShell,
  type CliShell,
  type CommandMenuItem,
  type PublishCommandInput
} from '@/utils/cli-command'
import { preparePublish } from '@/utils/publish'

/** An item of a history entry's "Copy as command" submenu (the shared menu model). */
export type HistoryCommandItem = CommandMenuItem

/** The generator input of a history entry, or why it cannot be published as is. */
export function historyCommandInput(
  profile: ConnectionProfile,
  item: PublishHistoryItem
): PublishCommandInput | { error: string } {
  const prepared = preparePublish(item, { protocolVersion: profile.protocolVersion })
  if (!prepared.ok) return { error: prepared.error }
  const { request } = prepared
  return {
    profile,
    topic: request.topic,
    payload: request.payload,
    qos: request.qos,
    retain: request.retain,
    properties: request.properties
  }
}

export function historyCommandItems(
  profile: ConnectionProfile | undefined,
  item: PublishHistoryItem,
  shell: CliShell
): HistoryCommandItem[] {
  return commandMenuItems(profile ? historyCommandInput(profile, item) : null, shell)
}

export interface HistoryCommand {
  itemsFor(item: PublishHistoryItem): HistoryCommandItem[]
  copy(item: HistoryCommandItem): Promise<boolean>
}

export function useHistoryCommand(connectionId: () => string | null): HistoryCommand {
  const connections = useConnectionsStore()
  return {
    itemsFor(item) {
      const id = connectionId()
      const profile = id === null ? undefined : connections.get(id)
      return historyCommandItems(profile, item, defaultCliShell(api.app.platform))
    },
    async copy(item) {
      if (!item.result.ok) return false
      try {
        await copyText(item.result.command)
      } catch {
        toast.error('Could not copy to the clipboard')
        return false
      }
      const { title, description } = copiedToast(item.result)
      toast.success(title, description ? { description } : undefined)
      return true
    }
  }
}
