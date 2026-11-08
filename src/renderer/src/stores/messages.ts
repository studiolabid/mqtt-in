/**
 * Message storage per connection — PERFORMANCE CRITICAL (>= 2 000 msg/s).
 *
 * Messages, buffers and topic trees live outside Vue reactivity. Views track a per-connection
 * revision counter that bumps once per ingested IPC batch (see ARCHITECTURE §4.2).
 *
 * Memory: each buffer is bounded by a message count (`maxMessagesPerConnection`) and a payload
 * byte budget (`MAX_RETAINED_BYTES`); evicted large payloads are released from the topic tree.
 * Readers never create state: a deleted (or unknown) connection reads as empty. Other stores
 * observe ingested batches through `onIngest` (e.g. the pins store).
 */
import { defineStore } from 'pinia'
import { markRaw, onScopeDispose, reactive, shallowReactive, watch } from 'vue'
import type { MqttMessage } from '@shared/models'
import { EMPTY_STATS, type ConnectionStats } from '@/types'
import { MessageBuffer, type MessageSource } from '@/utils/message-buffer'
import { TopicHistoryViews } from '@/utils/topic-history'
import { snapshotTopicNode, TopicTree, type TopicNodeSnapshot } from '@/utils/topic-tree'
import { onConnectionRemoved } from './connection-lifecycle'
import { useSettingsStore } from './settings'

const RATE_TICK_MS = 1000
const EMPTY: readonly MqttMessage[] = Object.freeze([])
/** What readers see for a connection without messages (generation 0 is never a buffer's). */
const EMPTY_SOURCE: MessageSource = Object.freeze({
  messages: EMPTY,
  evicted: 0,
  appended: 0,
  generation: 0
})
/** The topic tree of a connection without messages (read only: never add to it). */
const EMPTY_TREE = markRaw(new TopicTree())

/** Observer of ingested messages: one call per connection and batch (incoming and outgoing). */
export type IngestListener = (connectionId: string, batch: readonly MqttMessage[]) => void

export const useMessagesStore = defineStore('messages', () => {
  const settings = useSettingsStore()
  const buffers = new Map<string, MessageBuffer>()
  const trees = new Map<string, TopicTree>()
  const history = new TopicHistoryViews()
  const snapshots = new Map<string, { revision: number; messages: readonly MqttMessage[] }>()
  const revisions = shallowReactive<Record<string, number>>({})
  const statsById = shallowReactive<Record<string, ConnectionStats>>({})
  const paused = reactive<Record<string, boolean>>({})
  const ingestListeners: IngestListener[] = []
  let rateTimer: ReturnType<typeof setInterval> | undefined

  watch(
    () => settings.settings.maxMessagesPerConnection,
    (capacity) => {
      for (const [id, buffer] of buffers) {
        const evicted = buffer.setCapacity(capacity)
        if (evicted.length === 0) continue
        release(id, evicted)
        bump(id, buffer)
      }
    }
  )

  onScopeDispose(stopRateTimer)
  onScopeDispose(onConnectionRemoved(forget))

  /** Reactive counter: bumps once per ingested batch (and on clear / capacity changes). */
  function revision(connectionId: string): number {
    return revisions[connectionId] ?? 0
  }

  /**
   * Buffer contents, oldest first (reading tracks the revision). A snapshot copied at most once
   * per revision, so it is safe in computeds; incremental consumers should prefer `sourceOf`.
   */
  function messages(connectionId: string): readonly MqttMessage[] {
    const rev = revision(connectionId)
    const buffer = buffers.get(connectionId)
    if (!buffer) return EMPTY
    const cached = snapshots.get(connectionId)
    if (cached && cached.revision === rev) return cached.messages
    const copy = buffer.messages.slice()
    snapshots.set(connectionId, { revision: rev, messages: copy })
    return copy
  }

  /** Number of messages currently in the buffer (reactive). */
  function count(connectionId: string): number {
    revision(connectionId)
    return buffers.get(connectionId)?.size ?? 0
  }

  /**
   * The live buffer as a `MessageSource` for incremental consumers such as `FilteredView`
   * (reading tracks the revision). It is mutated in place: never mutate it and never return it
   * from a computed (its identity does not change while the connection has messages).
   */
  function sourceOf(connectionId: string): MessageSource {
    revision(connectionId)
    return buffers.get(connectionId) ?? EMPTY_SOURCE
  }

  /**
   * Live topic tree (reading tracks the revision). The tree and its nodes are mutated in place:
   * derive new values from it (`flatten()`, `topicNode()`) instead of returning nodes from
   * computeds, whose identity would not change.
   */
  function topicTree(connectionId: string): TopicTree {
    revision(connectionId)
    return trees.get(connectionId) ?? EMPTY_TREE
  }

  /** Snapshot of one topic node (a new object per call; reactive via the revision). */
  function topicNode(connectionId: string, topic: string): TopicNodeSnapshot | undefined {
    revision(connectionId)
    const node = trees.get(connectionId)?.get(topic)
    return node ? snapshotTopicNode(node) : undefined
  }

  /**
   * Known-retained topics in the subtree of `topic`, the topic itself included, in natural
   * order (CT-14; reactive via the revision). `[]` for an unknown topic.
   */
  function retainedBelow(connectionId: string, topic: string): string[] {
    revision(connectionId)
    return trees.get(connectionId)?.retainedBelow(topic) ?? []
  }

  /**
   * Counters (including evicted messages), payload bytes held and msg/s rates over the last
   * 5 s (reactive).
   */
  function stats(connectionId: string): ConnectionStats {
    return statsById[connectionId] ?? EMPTY_STATS
  }

  /** Message by id, while it is still in the buffer. */
  function findById(connectionId: string, id: number): MqttMessage | undefined {
    revision(connectionId)
    return buffers.get(connectionId)?.findById(id)
  }

  /**
   * The newest `limit` messages of exactly `topic`, oldest first. Maintained incrementally and
   * cached per topic and limit (callers with different limits do not evict each other): the
   * same array is returned until the history changes.
   */
  function topicHistory(connectionId: string, topic: string, limit = 500): readonly MqttMessage[] {
    const source = sourceOf(connectionId)
    if (source === EMPTY_SOURCE) return EMPTY
    return history.rows(connectionId, topic, limit, source)
  }

  /** Removes the messages, the topic tree and the statistics of a connection. */
  function clear(connectionId: string): void {
    const buffer = buffers.get(connectionId)
    buffer?.clear()
    trees.get(connectionId)?.clear()
    history.delete(connectionId)
    snapshots.delete(connectionId)
    revisions[connectionId] = revision(connectionId) + 1
    statsById[connectionId] = buffer ? buffer.stats : { ...EMPTY_STATS }
  }

  /** Drops everything of a deleted connection (registered with `onConnectionRemoved`). */
  function forget(connectionId: string): void {
    buffers.delete(connectionId)
    trees.delete(connectionId)
    history.delete(connectionId)
    snapshots.delete(connectionId)
    delete revisions[connectionId]
    delete statsById[connectionId]
    delete paused[connectionId]
  }

  /**
   * Observes every ingested batch, after it was stored (one call per connection and batch,
   * incoming and outgoing messages in order). A throwing listener is logged and skipped.
   *
   * @returns a function that removes the listener.
   */
  function onIngest(listener: IngestListener): () => void {
    ingestListeners.push(listener)
    return () => {
      const index = ingestListeners.indexOf(listener)
      if (index !== -1) ingestListeners.splice(index, 1)
    }
  }

  /** Paused views keep showing what they showed; ingestion continues. */
  function isPaused(connectionId: string): boolean {
    return paused[connectionId] === true
  }

  function setPaused(connectionId: string, value: boolean): void {
    if (value) paused[connectionId] = true
    else delete paused[connectionId]
  }

  function togglePaused(connectionId: string): void {
    setPaused(connectionId, !isPaused(connectionId))
  }

  /** Stores an IPC batch (incoming and outgoing, in order), grouped by connection. */
  function ingest(batch: readonly MqttMessage[]): void {
    if (batch.length === 0) return
    const first = batch[0].connectionId
    let mixed = false
    for (let i = 1; i < batch.length; i++) {
      if (batch[i].connectionId !== first) {
        mixed = true
        break
      }
    }
    if (!mixed) append(first, batch)
    else {
      const groups = new Map<string, MqttMessage[]>()
      for (const message of batch) {
        const group = groups.get(message.connectionId)
        if (group) group.push(message)
        else groups.set(message.connectionId, [message])
      }
      for (const [id, messages] of groups) append(id, messages)
    }
    if (rateTimer === undefined) rateTimer = setInterval(tickRates, RATE_TICK_MS)
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  function append(connectionId: string, batch: readonly MqttMessage[]): void {
    let buffer = buffers.get(connectionId)
    if (!buffer) {
      buffer = markRaw(new MessageBuffer(settings.settings.maxMessagesPerConnection))
      buffers.set(connectionId, buffer)
    }
    let tree = trees.get(connectionId)
    if (!tree) {
      tree = markRaw(new TopicTree())
      trees.set(connectionId, tree)
    }
    for (const message of batch) {
      // Never let a message become deeply reactive, even if a view stores it in a ref.
      markRaw(message)
      tree.add(message)
    }
    release(connectionId, buffer.push(batch))
    for (const listener of ingestListeners) {
      try {
        listener(connectionId, batch)
      } catch (err) {
        console.error('[mqtey] message ingest listener failed:', err)
      }
    }
    bump(connectionId, buffer)
  }

  /** Lets the topic tree drop the large payloads of evicted messages. */
  function release(connectionId: string, evicted: readonly MqttMessage[]): void {
    if (evicted.length === 0) return
    for (const copy of trees.get(connectionId)?.releaseEvicted(evicted) ?? []) markRaw(copy)
  }

  function bump(connectionId: string, buffer: MessageBuffer): void {
    revisions[connectionId] = revision(connectionId) + 1
    statsById[connectionId] = buffer.stats
  }

  function tickRates(): void {
    const now = Date.now()
    let active = false
    for (const [id, buffer] of buffers) {
      if (!buffer.ratesActive) continue
      const before = statsById[id]
      if (buffer.tick(now)) active = true
      const after = buffer.stats
      if (!before || before.inRate !== after.inRate || before.outRate !== after.outRate) {
        statsById[id] = after
      }
    }
    if (!active) stopRateTimer()
  }

  function stopRateTimer(): void {
    if (rateTimer !== undefined) clearInterval(rateTimer)
    rateTimer = undefined
  }

  return {
    revision,
    messages,
    count,
    sourceOf,
    topicTree,
    topicNode,
    retainedBelow,
    stats,
    findById,
    topicHistory,
    clear,
    forget,
    isPaused,
    setPaused,
    togglePaused,
    ingest,
    onIngest
  }
})
