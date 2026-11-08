/**
 * Unread message counts per connection (FP-2, CT-12). Internal helper of `useUiStore`.
 *
 * No per-message work: a count is the connection's `received` counter (incoming messages only)
 * minus the counter seen when its workspace was last shown. The mark remembers the buffer
 * generation, so `useMessagesStore().clear(id)` (a new generation, counters back to 0) resets it.
 * While a workspace is shown its count is 0; leaving it records the mark. Reading a count
 * tracks the connection's message statistics, so it is reactive.
 */
import { computed, shallowReactive, shallowRef, type ComputedRef } from 'vue'
import type { ConnectionStats } from '@/types'
import type { MessageSource } from '@/utils/message-buffer'

/** The parts of `useMessagesStore()` the counts read. */
export interface UnreadSource {
  stats(connectionId: string): ConnectionStats
  sourceOf(connectionId: string): MessageSource
}

export interface UnreadCounts {
  /** Connection whose workspace is shown (the current route), or null. */
  shownConnectionId: ComputedRef<string | null>
  /** Called on every navigation (router `afterEach`) with the shown connection, or null. */
  setShownConnection(connectionId: string | null): void
  /** Incoming messages since the workspace was last shown; 0 while it is shown. */
  unreadCount(connectionId: string): number
  /** Drops the mark of a deleted connection. */
  forget(connectionId: string): void
}

interface SeenMark {
  received: number
  generation: number
}

export function createUnreadCounts(messages: UnreadSource): UnreadCounts {
  const shown = shallowRef<string | null>(null)
  const seen = shallowReactive<Record<string, SeenMark>>({})

  function markSeen(connectionId: string): void {
    seen[connectionId] = {
      received: messages.stats(connectionId).received,
      generation: messages.sourceOf(connectionId).generation
    }
  }

  function setShownConnection(connectionId: string | null): void {
    const previous = shown.value
    if (previous === connectionId) return
    if (previous !== null) markSeen(previous)
    shown.value = connectionId
  }

  function unreadCount(connectionId: string): number {
    if (shown.value === connectionId) return 0
    const received = messages.stats(connectionId).received
    const mark = seen[connectionId]
    const base =
      mark && mark.generation === messages.sourceOf(connectionId).generation ? mark.received : 0
    return Math.max(0, received - base)
  }

  function forget(connectionId: string): void {
    delete seen[connectionId]
    if (shown.value === connectionId) shown.value = null
  }

  return {
    shownConnectionId: computed(() => shown.value),
    setShownConnection,
    unreadCount,
    forget
  }
}
