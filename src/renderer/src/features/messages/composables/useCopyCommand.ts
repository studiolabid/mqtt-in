/**
 * "Copy as command" for messages (FP-4): the 'Copy as command' submenu of a message (one item
 * per CLI tool, disabled with the generator's reason when it cannot express the message) and
 * the copy action with its toast. The command is built by `@/utils/cli-command` from the
 * connection's profile and the message's exact bytes, QoS, retain flag and MQTT 5 properties,
 * for the platform's shell (PowerShell on Windows).
 *
 * The menu model and the toast text are shared with the publish history
 * (`commandMenuItems` / `copiedToast` in `@/utils/cli-command`), re-exported here.
 */
import { toValue, type MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
import type { ConnectionProfile, MqttMessage, PublishProperties } from '@shared/models'
// The helper itself, not the components barrel (which loads every SFC).
import { copyText } from '@/components/common/lib/clipboard'
import { api } from '@/services/api'
import { useConnectionsStore } from '@/stores'
import {
  commandMenuItems,
  copiedToast,
  defaultCliShell,
  type CommandMenuItem,
  type PublishCommandInput
} from '@/utils/cli-command'

export {
  commandMenuItems,
  copiedToast,
  type CommandMenuItem,
  type CommandTool
} from '@/utils/cli-command'

/** The PUBLISH properties of a message (not the topic alias or subscription identifiers). */
export function messagePublishProperties(message: MqttMessage): PublishProperties | undefined {
  const source = message.properties
  if (!source) return undefined
  return {
    payloadFormatIndicator: source.payloadFormatIndicator,
    messageExpiryInterval: source.messageExpiryInterval,
    contentType: source.contentType,
    responseTopic: source.responseTopic,
    correlationData: source.correlationData,
    userProperties: source.userProperties ?? []
  }
}

/** What the generator gets for a message: its exact payload bytes, flags and properties. */
export function messageCommandInput(
  profile: ConnectionProfile,
  message: MqttMessage
): PublishCommandInput {
  return {
    profile,
    topic: message.topic,
    payload: message.payload,
    qos: message.qos,
    retain: message.retain,
    properties: messagePublishProperties(message)
  }
}

/**
 * Copies a command item's text to the clipboard and toasts the outcome ('Command copied', with
 * the password variable and the shell caveat when they apply).
 */
export async function copyCommand(item: CommandMenuItem): Promise<boolean> {
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

export interface CopyCommand {
  /** The submenu items for a message of the connection. */
  itemsFor(message: MqttMessage): CommandMenuItem[]
  copy(item: CommandMenuItem): Promise<boolean>
}

export function useCopyCommand(connectionId: MaybeRefOrGetter<string>): CopyCommand {
  const connections = useConnectionsStore()
  return {
    itemsFor(message) {
      const profile = connections.get(toValue(connectionId))
      const shell = defaultCliShell(api.app.platform)
      return commandMenuItems(profile ? messageCommandInput(profile, message) : null, shell)
    },
    copy: copyCommand
  }
}
