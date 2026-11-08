/**
 * Publishing: per-connection draft, history (persisted), single publish, re-publish of a
 * received message and repeat jobs.
 */
import { defineStore } from 'pinia'
import { onScopeDispose, ref, toRaw } from 'vue'
import { toast } from 'vue-sonner'
import type { MqttMessage, MqttProtocolVersion } from '@shared/models'
import { newId } from '@shared/defaults'
import { api, errorMessage } from '@/services/api'
import type { PublishDraft, PublishHistoryItem } from '@/types'
import { toPlain } from '@/utils/plain'
import {
  createPublishDraft,
  draftFromMessage,
  preparePublish,
  sameDraftContent
} from '@/utils/publish'
import { onConnectionRemoved } from './connection-lifecycle'
import { useConnectionsStore } from './connections'
import { useMessagesStore } from './messages'
import { createPublishPersistence } from './publish-persistence'
import { createRepeatJobs } from './publish-repeat'

/** History entries kept per connection (newest first). */
export const MAX_PUBLISH_HISTORY = 100
const MAX_TOPIC_SUGGESTIONS = 200
const EMPTY_HISTORY: readonly PublishHistoryItem[] = Object.freeze([])

/** Options of `usePublishStore().publish()` (CT-14). */
export interface PublishOptions {
  /** Add to the publish history (default true). */
  history?: boolean
  /** Called with the human message instead of the error toast. */
  onError?: (message: string) => void
}

export const usePublishStore = defineStore('publish', () => {
  const drafts = ref<Record<string, PublishDraft>>({})
  const historyById = ref<Record<string, PublishHistoryItem[]>>({})
  const persistence = createPublishPersistence({ drafts, history: historyById })
  onScopeDispose(onConnectionRemoved(forget))

  /**
   * The reactive draft of a connection (created with defaults on first use); bind inputs to
   * its fields directly.
   */
  function draft(connectionId: string): PublishDraft {
    // Check through the raw object: creating the draft must not re-trigger a running computed.
    if (!(connectionId in toRaw(drafts.value))) drafts.value[connectionId] = createPublishDraft()
    return drafts.value[connectionId]
  }

  /** Merges `patch` into the draft. */
  function updateDraft(connectionId: string, patch: Partial<PublishDraft>): void {
    Object.assign(draft(connectionId), toPlain(patch))
  }

  /** Restores the default draft. */
  function resetDraft(connectionId: string): void {
    drafts.value[connectionId] = createPublishDraft()
  }

  /**
   * Publishes the draft (optionally overridden, e.g. for "publish again"): validates the topic
   * and the MQTT string limits, renders templates (`{{counter}}` = 1), encodes the payload and
   * sends MQTT 5 properties only to MQTT 5 brokers. Successful publishes are added to the
   * history unless `options.history` is false. Problems are toasted, or passed to
   * `options.onError` (e.g. a bulk "clear retained" that reports one summary).
   *
   * @returns whether the broker accepted the publish (the main process resolved).
   */
  async function publish(
    connectionId: string,
    override: Partial<PublishDraft> = {},
    options: PublishOptions = {}
  ): Promise<boolean> {
    const source: PublishDraft = { ...toPlain(draft(connectionId)), ...toPlain(override) }
    const prepared = preparePublish(source, { protocolVersion: protocolVersion(connectionId) })
    if (!prepared.ok) {
      if (options.onError) options.onError(prepared.error)
      else toast.error(prepared.error)
      return false
    }
    try {
      await api.mqtt.publish(connectionId, prepared.request)
    } catch (err) {
      const message = errorMessage(err)
      if (options.onError) options.onError(message)
      else toast.error('Publish failed', { description: message })
      return false
    }
    if (options.history !== false) pushHistory(connectionId, source)
    return true
  }

  /** History of a connection, newest first. */
  function history(connectionId: string): readonly PublishHistoryItem[] {
    return historyById.value[connectionId] ?? EMPTY_HISTORY
  }

  function removeHistoryItem(connectionId: string, itemId: string): void {
    const list = historyById.value[connectionId]
    if (list) historyById.value[connectionId] = list.filter((item) => item.id !== itemId)
  }

  function clearHistory(connectionId: string): void {
    delete historyById.value[connectionId]
  }

  /** Copies a history entry into the draft. */
  function loadFromHistory(connectionId: string, itemId: string): void {
    const item = history(connectionId).find((entry) => entry.id === itemId)
    if (!item) return
    const copy: Partial<PublishHistoryItem> = toPlain(item)
    delete copy.id
    delete copy.timestamp
    drafts.value[connectionId] = createPublishDraft(copy)
  }

  /**
   * Turns a received (or sent) message into the draft: topic, QoS, retain, properties and an
   * editable payload (pretty JSON, text or hex).
   */
  function loadFromMessage(connectionId: string, message: MqttMessage): void {
    drafts.value[connectionId] = draftFromMessage(message, draft(connectionId))
  }

  /** Topics for autocompletion: history first, then recently active topics (max 200). */
  function topicSuggestions(connectionId: string): string[] {
    const seen = new Set<string>()
    for (const item of history(connectionId)) {
      if (seen.size >= MAX_TOPIC_SUGGESTIONS) break
      seen.add(item.topic)
    }
    if (seen.size < MAX_TOPIC_SUGGESTIONS) {
      const tree = useMessagesStore().topicTree(connectionId)
      for (const topic of tree.topics(MAX_TOPIC_SUGGESTIONS)) {
        if (seen.size >= MAX_TOPIC_SUGGESTIONS) break
        seen.add(topic)
      }
    }
    return Array.from(seen)
  }

  const repeat = createRepeatJobs({ draft, protocolVersion })

  /** Loads persisted drafts and history (called once by `initApp`). */
  function load(): Promise<void> {
    return persistence.load()
  }

  /** Drops drafts / history of connections that no longer exist. */
  function prune(validIds: ReadonlySet<string>): void {
    for (const id of Object.keys(drafts.value)) if (!validIds.has(id)) delete drafts.value[id]
    for (const id of Object.keys(historyById.value)) {
      if (!validIds.has(id)) delete historyById.value[id]
    }
  }

  /** Drops everything of a deleted connection (registered with `onConnectionRemoved`). */
  function forget(connectionId: string): void {
    delete drafts.value[connectionId]
    delete historyById.value[connectionId]
    repeat.forgetJobs(connectionId)
  }

  function protocolVersion(connectionId: string): MqttProtocolVersion {
    return useConnectionsStore().get(connectionId)?.protocolVersion ?? 5
  }

  function pushHistory(connectionId: string, source: PublishDraft): void {
    const list = historyById.value[connectionId] ?? []
    if (list.length > 0 && sameDraftContent(list[0], source)) return
    const item: PublishHistoryItem = {
      ...createPublishDraft(source),
      id: newId(),
      timestamp: Date.now()
    }
    historyById.value[connectionId] = [item, ...list].slice(0, MAX_PUBLISH_HISTORY)
  }

  return {
    drafts,
    history,
    draft,
    updateDraft,
    resetDraft,
    publish,
    removeHistoryItem,
    clearHistory,
    loadFromHistory,
    loadFromMessage,
    topicSuggestions,
    jobs: repeat.jobs,
    jobsFor: repeat.jobsFor,
    activeJobFor: repeat.activeJobFor,
    startRepeat: repeat.startRepeat,
    stopRepeat: repeat.stopRepeat,
    handleRepeat: repeat.handleRepeat,
    load,
    flush: persistence.flush,
    prune,
    forget
  }
})
