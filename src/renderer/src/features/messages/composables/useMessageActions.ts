/**
 * Message actions shared by the row hover bar, the context menu, the keyboard and the detail
 * panel. Cross-feature effects go through the stores (publish draft, workspace tab, filter).
 */
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
import type { MqttMessage, ViewFormat } from '@shared/models'
import { useCopy } from '@/composables'
import { usePublishStore, useSessionsStore, useUiStore } from '@/stores'
import { draftFromMessage } from '@/utils/publish'
import { messageAsJson, payloadText } from '../utils/message-meta'

export interface MessageActions {
  /** Whether "publish again" can work right now (connected). */
  canPublish: ComputedRef<boolean>
  /** Copies the payload decoded with `format` (default: the connection's view format). */
  copyPayload(message: MqttMessage, format?: ViewFormat, pretty?: boolean): Promise<boolean>
  copyTopic(message: MqttMessage): Promise<boolean>
  copyAsJson(message: MqttMessage): Promise<boolean>
  /** Loads the message into the publisher and focuses it. */
  editAndPublish(message: MqttMessage): void
  /** Publishes the same topic, payload, QoS, retain flag and properties again. */
  publishAgain(message: MqttMessage): Promise<boolean>
  filterByTopic(topic: string): void
  showInTopicTree(topic: string): void
}

export function useMessageActions(connectionId: MaybeRefOrGetter<string>): MessageActions {
  const ui = useUiStore()
  const publish = usePublishStore()
  const sessions = useSessionsStore()
  const { copy } = useCopy()

  const id = (): string => toValue(connectionId)

  return {
    canPublish: computed(() => sessions.isConnected(id())),
    copyPayload: (message, format, pretty = false) =>
      copy(payloadText(message, format ?? ui.viewFormat(id()), pretty), 'payload'),
    copyTopic: (message) => copy(message.topic, 'topic'),
    copyAsJson: (message) => copy(messageAsJson(message, ui.viewFormat(id())), 'message as JSON'),
    editAndPublish(message) {
      publish.loadFromMessage(id(), message)
      ui.requestPublishFocus(id())
    },
    async publishAgain(message) {
      const draft = draftFromMessage(message, publish.draft(id()))
      const ok = await publish.publish(id(), { ...draft, useTemplate: false })
      if (ok) toast.success('Published again', { description: message.topic })
      return ok
    },
    filterByTopic: (topic) => ui.updateMessageFilter(id(), { topic }),
    showInTopicTree: (topic) => ui.showTopic(id(), topic)
  }
}
