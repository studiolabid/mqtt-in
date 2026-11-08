/**
 * Per-connection event log (capped). Entries live outside deep reactivity; views track a
 * revision counter that bumps at most every 100 ms, so debug-level packet logs stay cheap.
 */
import { defineStore } from 'pinia'
import { onScopeDispose, shallowReactive } from 'vue'
import type { LogEntry, LogLevel } from '@shared/models'
import { countLogLevels } from '@/utils/logs'
import { throttle } from '@/utils/throttle'
import { onConnectionRemoved } from './connection-lifecycle'

/** Entries kept per connection (the oldest are dropped in chunks). */
export const MAX_LOG_ENTRIES = 2000
const EVICTION_CHUNK = 200
const REVISION_INTERVAL_MS = 100
const EMPTY: readonly LogEntry[] = Object.freeze([])

export const useLogsStore = defineStore('logs', () => {
  const buffers = new Map<string, LogEntry[]>()
  const snapshots = new Map<string, { revision: number; entries: readonly LogEntry[] }>()
  const revisions = shallowReactive<Record<string, number>>({})
  const dirty = new Set<string>()
  let nextLocalId = -1

  const publishRevisions = throttle(() => {
    for (const id of dirty) revisions[id] = (revisions[id] ?? 0) + 1
    dirty.clear()
  }, REVISION_INTERVAL_MS)

  onScopeDispose(() => publishRevisions.cancel())
  onScopeDispose(onConnectionRemoved(forget))

  /** Reactive change counter of a connection's log. */
  function revision(connectionId: string): number {
    return revisions[connectionId] ?? 0
  }

  /** Entries, oldest first (reactive via the revision; a new array after every change). */
  function entries(connectionId: string): readonly LogEntry[] {
    const rev = revision(connectionId)
    const list = buffers.get(connectionId)
    if (!list || list.length === 0) return EMPTY // reading never creates state
    const cached = snapshots.get(connectionId)
    if (cached && cached.revision === rev) return cached.entries
    const snapshot = Object.freeze(list.slice())
    snapshots.set(connectionId, { revision: rev, entries: snapshot })
    return snapshot
  }

  /** Entries per level (reactive via the revision). */
  function counts(connectionId: string): Record<LogLevel, number> {
    return countLogLevels(entries(connectionId))
  }

  /** Stores an entry from the main process. */
  function handle(entry: LogEntry): void {
    push(entry)
  }

  /** Adds a renderer-side entry (negative ids never collide with main-process ids). */
  function add(connectionId: string, level: LogLevel, message: string, detail?: string): LogEntry {
    const entry: LogEntry = {
      id: nextLocalId--,
      connectionId,
      level,
      message,
      timestamp: Date.now()
    }
    if (detail !== undefined) entry.detail = detail
    push(entry)
    return entry
  }

  /** Removes every entry of a connection. */
  function clear(connectionId: string): void {
    buffers.delete(connectionId)
    snapshots.delete(connectionId)
    markDirty(connectionId)
    publishRevisions.flush()
  }

  /** Drops the log of a deleted connection (registered with `onConnectionRemoved`). */
  function forget(connectionId: string): void {
    buffers.delete(connectionId)
    snapshots.delete(connectionId)
    dirty.delete(connectionId)
    delete revisions[connectionId]
  }

  function push(entry: LogEntry): void {
    let list = buffers.get(entry.connectionId)
    if (!list) {
      list = []
      buffers.set(entry.connectionId, list)
    }
    list.push(Object.freeze({ ...entry }))
    if (list.length > MAX_LOG_ENTRIES) {
      list.splice(0, list.length - MAX_LOG_ENTRIES + EVICTION_CHUNK)
    }
    markDirty(entry.connectionId)
  }

  function markDirty(connectionId: string): void {
    dirty.add(connectionId)
    publishRevisions()
  }

  return { revision, entries, counts, handle, add, clear, forget }
})
