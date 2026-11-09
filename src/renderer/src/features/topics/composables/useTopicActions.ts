/**
 * Topic actions shared by the tree context menu and the detail panel. Cross-feature effects go
 * through the stores only (publish draft + focus request, message filter, dialogs).
 *
 * Clearing retained messages (FP-1, PRODUCT-03/04, MQTT-22): an empty retained PUBLISH at QoS 1
 * (capped by the broker's Maximum QoS), so a refusal shows as an error instead of "cleared".
 * Clears never enter the publish history (nor, through it, the topic suggestions). A single
 * clear is offered for any topic with a payload: live deliveries usually arrive without the
 * retain flag, so "not known to be retained" does not mean the broker keeps nothing. A branch
 * can clear every known-retained topic below it at once, 8 at a time, with a progress toast.
 */
import { computed, reactive, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
import { isMqttProfile } from '@shared/connection-kind'
import type { MqttMessage } from '@shared/models'
import { useCopy } from '@/composables/useCopy'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { useConnectionsStore } from '@/stores/connections'
import { useMessagesStore } from '@/stores/messages'
import { usePublishStore } from '@/stores/publish'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import { DEFAULT_MESSAGE_FILTER } from '@/types'
import {
  bulkConfirm,
  CLEAR_CONCURRENCY,
  clearQos,
  clearSummary,
  progressText,
  runLimited,
  singleConfirm
} from '../utils/clear-retained'
import { subtreeFilter } from '../utils/topic-path'

/** "connectionId\0topic" of clears in progress (shared by every instance). */
const clearing = reactive(new Set<string>())
/** "connectionId\0topic" of branches whose retained messages are being cleared. */
const clearingBelow = reactive(new Set<string>())
/** The progress toast is updated at most this often. */
const PROGRESS_INTERVAL_MS = 100

export interface ClearRetainedOptions {
  /** The topic is known to hold a retained message (default true): changes the confirm text. */
  known?: boolean
}

export interface TopicActions {
  /** Whether the connection is connected (clearing a retained message needs a session). */
  connected: ComputedRef<boolean>
  /**
   * An MQTT connection: subscriptions and retained messages exist. WebSocket / Socket.IO
   * connections offer neither (clearing would send empty events to the server).
   */
  mqtt: ComputedRef<boolean>
  copyTopic(topic: string): void
  /** Prefills the publisher with the topic and focuses it. */
  publishTo(topic: string): void
  /** Opens the publisher with a copy of the message (topic, payload, QoS, retain, properties). */
  editAndPublish(message: MqttMessage): void
  /** Shows the message list filtered to the topic (`subtree`: the node and all below it). */
  filterMessages(topic: string, subtree: boolean): void
  /** Opens the subscription dialog prefilled with the topic (or its subtree filter). */
  subscribe(topic: string, subtree: boolean): void
  /** Confirms, then publishes an empty retained message (the MQTT way to delete it). */
  clearRetained(topic: string, options?: ClearRetainedOptions): Promise<boolean>
  isClearing(topic: string): boolean
  /**
   * Confirms, then clears every known-retained topic below `topic` (itself included).
   *
   * @returns how many were cleared.
   */
  clearRetainedBelow(topic: string): Promise<number>
  isClearingBelow(topic: string): boolean
}

export function useTopicActions(connectionId: MaybeRefOrGetter<string>): TopicActions {
  const ui = useUiStore()
  const publish = usePublishStore()
  const sessions = useSessionsStore()
  const messages = useMessagesStore()
  const { copy } = useCopy()
  const id = (): string => toValue(connectionId)
  const connections = useConnectionsStore()
  const mqtt = computed(() => {
    const profile = connections.get(id())
    return !profile || isMqttProfile(profile)
  })
  const key = (topic: string): string => `${id()}\u0000${topic}`

  function ensureConnected(): boolean {
    if (sessions.isConnected(id())) return true
    toast.error('Not connected', { description: 'Connect to clear retained messages.' })
    return false
  }

  /** One empty retained publish; refusals go to `onError` (never a toast of its own). */
  function publishClear(
    connection: string,
    topic: string,
    onError: (message: string) => void
  ): Promise<boolean> {
    const qos = clearQos(sessions.brokerInfo(connection)?.maximumQoS)
    return publish.publish(
      connection,
      {
        topic,
        payload: '',
        format: 'text',
        retain: true,
        qos,
        useTemplate: false,
        properties: { userProperties: [] }
      },
      { history: false, onError }
    )
  }

  async function clearRetained(
    topic: string,
    options: ClearRetainedOptions = {}
  ): Promise<boolean> {
    if (!mqtt.value || clearing.has(key(topic)) || !ensureConnected()) return false
    const text = singleConfirm(topic, options.known ?? true)
    const confirmed = await ui.confirmDestructive({ ...text, confirmText: 'Clear retained' })
    if (!confirmed) return false
    const connection = id()
    const entry = `${connection}\u0000${topic}`
    clearing.add(entry)
    try {
      const failure: { message?: string } = {}
      const ok = await publishClear(connection, topic, (message) => {
        failure.message = message
      })
      if (ok) toast.success('Retained message cleared', { description: topic })
      else {
        toast.error('Could not clear the retained message', {
          description: failure.message ?? topic
        })
      }
      return ok
    } finally {
      clearing.delete(entry)
    }
  }

  async function clearRetainedBelow(topic: string): Promise<number> {
    if (!mqtt.value || clearingBelow.has(key(topic)) || !ensureConnected()) return 0
    const connection = id()
    const topics = messages.retainedBelow(connection, topic)
    if (topics.length === 0) return 0
    const confirmed = await ui.confirmDestructive({
      ...bulkConfirm(topics),
      confirmText: 'Clear retained'
    })
    if (!confirmed) return 0
    const entry = `${connection}\u0000${topic}`
    clearingBelow.add(entry)
    const progress = toast.loading(progressText(0, topics.length))
    const failures: string[] = []
    let shownAt = 0
    try {
      await runLimited(
        topics,
        CLEAR_CONCURRENCY,
        async (target) => {
          let reported = false
          const ok = await publishClear(connection, target, (message) => {
            reported = true
            failures.push(message)
          })
          if (!ok && !reported) failures.push('Publish failed')
        },
        (done) => {
          const now = Date.now()
          if (done < topics.length && now - shownAt < PROGRESS_INTERVAL_MS) return
          shownAt = now
          toast.loading(progressText(done, topics.length), { id: progress })
        }
      )
    } finally {
      clearingBelow.delete(entry)
    }
    const summary = clearSummary(topics.length, failures)
    if (summary.ok) toast.success(summary.title, { id: progress })
    // A partial failure explains itself: give it time to be read.
    else toast.error(summary.title, { id: progress, duration: ACTION_TOAST_DURATION })
    return topics.length - failures.length
  }

  return {
    connected: computed(() => sessions.isConnected(id())),
    mqtt,
    copyTopic: (topic) => void copy(topic, 'topic'),
    publishTo(topic) {
      publish.updateDraft(id(), { topic })
      ui.requestPublishFocus(id())
    },
    editAndPublish(message) {
      publish.loadFromMessage(id(), message)
      ui.requestPublishFocus(id())
    },
    filterMessages(topic, subtree) {
      ui.showMessages(id(), {
        ...DEFAULT_MESSAGE_FILTER,
        topic: subtree ? subtreeFilter(topic) : topic
      })
    },
    subscribe(topic, subtree) {
      ui.openNewSubscription(id(), { topic: subtree ? subtreeFilter(topic) : topic })
    },
    clearRetained,
    isClearing: (topic) => clearing.has(key(topic)),
    clearRetainedBelow,
    isClearingBelow: (topic) => clearingBelow.has(key(topic))
  }
}
