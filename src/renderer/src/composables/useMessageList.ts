/**
 * Filtered, throttled, pause-aware message list of a connection (for the virtualized list).
 *
 * Re-filtering a large buffer (a new search term, filter or view format) runs in ~8 ms slices,
 * one macrotask each, newest messages first: the renderer keeps painting and handling input,
 * and the bottom of the list fills first. A newer filter drops an unfinished pass.
 */
import {
  computed,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type ShallowRef
} from 'vue'
import type { MqttMessage } from '@shared/models'
import { useMessagesStore } from '@/stores/messages'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { useUiStore } from '@/stores/ui'
import type { MessageFilter } from '@/types'
import { FilteredView, type MessagePredicate } from '@/utils/filtered-view'
import { createMacrotask } from '@/utils/macrotask'
import type { MessageSource } from '@/utils/message-buffer'
import { createMessagePredicate, isMessageFilterActive } from '@/utils/message-filter'
import { throttle } from '@/utils/throttle'

/** Time one slice of a re-filtering pass may take (ms): about half a frame. */
export const REBUILD_SLICE_MS = 8
/** Minimum time between two list updates under load (ms). */
export const LIST_THROTTLE_MS = 100
/** Above this rate (msg/s, in + out) the rows scroll by too fast to read: update half as often. */
export const FAST_MESSAGE_RATE = 1_000
export const FAST_LIST_THROTTLE_MS = 200

/**
 * The update interval of a list whose connection moves `rate` messages per second. Following
 * a 2,500 msg/s flood at 200 ms instead of 100 ms took the renderer from about 8.6 % to 6.2 %
 * busy (real app).
 */
export function listThrottleMs(rate: number): number {
  return rate > FAST_MESSAGE_RATE ? FAST_LIST_THROTTLE_MS : LIST_THROTTLE_MS
}

export interface MessageListOptions {
  /**
   * Minimum time between two updates under load (ms). Default: adaptive (`listThrottleMs`),
   * 100 ms, or 200 ms while the connection moves more than 1,000 msg/s.
   */
  throttleMs?: number
}

export interface MessageList {
  /** Matching messages, oldest first. A new array on every change; frozen while paused. */
  rows: ShallowRef<readonly MqttMessage[]>
  /** Messages in the connection's buffer (live, also while paused). */
  total: ComputedRef<number>
  /** Number of rows. */
  matched: ComputedRef<number>
  /** Whether the connection's views are paused. */
  paused: ComputedRef<boolean>
  /**
   * True while a re-filtering pass is still running (slice by slice): `rows` then holds the
   * newest matches found so far, and `matched` grows until it is false again.
   */
  pending: ComputedRef<boolean>
}

function snapshot(source: MessageSource): MessageSource {
  return {
    messages: source.messages.slice(),
    evicted: source.evicted,
    appended: source.appended,
    generation: source.generation
  }
}

/**
 * Keeps `rows` in sync with the connection's buffer and `filter`. New messages are filtered
 * incrementally (at most every 100 ms, or 200 ms above 1,000 msg/s: `listThrottleMs`); a filter
 * change re-filters everything, time-sliced (`REBUILD_SLICE_MS` per macrotask). The text search
 * matches payloads as the connection's view format shows them (`createMessagePredicate`).
 */
export function useMessageList(
  connectionId: MaybeRefOrGetter<string>,
  filter: MaybeRefOrGetter<MessageFilter>,
  options: MessageListOptions = {}
): MessageList {
  const messages = useMessagesStore()
  const subscriptions = useSubscriptionsStore()
  const ui = useUiStore()

  const id = computed(() => toValue(connectionId))
  const paused = computed(() => messages.isPaused(id.value))
  const rows = shallowRef<readonly MqttMessage[]>([])
  const pending = shallowRef(false)
  const view = new FilteredView()
  /** Runs the next slice of an unfinished re-filtering pass. */
  const nextSlice = createMacrotask(() => update())
  /** Snapshot of the buffer taken when the connection was paused. */
  let frozen: MessageSource | null = null

  /** Everything the predicate depends on, as a string (rebuild only on real changes). */
  const filterKey = computed(() => {
    const f = toValue(filter)
    const subscription = f.subscriptionId ? subscriptions.get(id.value, f.subscriptionId) : null
    const format = f.search.trim() ? ui.viewFormat(id.value) : null
    return JSON.stringify([
      f.direction,
      f.topic,
      f.search,
      f.subscriptionId,
      f.retainedOnly,
      subscription?.topic ?? null,
      subscription?.subscriptionIdentifier ?? null,
      format
    ])
  })

  function buildPredicate(): MessagePredicate | null {
    const f = toValue(filter)
    if (!isMessageFilterActive(f)) return null
    return createMessagePredicate(f, {
      subscriptions: subscriptions.list(id.value),
      viewFormat: ui.viewFormat(id.value)
    })
  }

  function update(): void {
    const live = messages.sourceOf(id.value)
    let source = live
    if (messages.isPaused(id.value)) {
      // A clear while paused starts a new generation: show the (cleared) buffer.
      if (!frozen || frozen.generation !== live.generation) frozen = snapshot(live)
      source = frozen
    } else {
      frozen = null
    }
    if (view.sync(source, { budgetMs: REBUILD_SLICE_MS })) rows.value = view.rows
    pending.value = view.pending
    if (view.pending) nextSlice.schedule()
    else nextSlice.cancel()
  }

  /** The update interval now: fixed by the caller, or following the connection's rate. */
  function intervalMs(): number {
    if (options.throttleMs !== undefined) return options.throttleMs
    const stats = messages.stats(id.value)
    return listThrottleMs(stats.inRate + stats.outRate)
  }

  let throttledMs = intervalMs()
  let throttled = throttle(update, throttledMs)

  /** Throttled `update`; a new throttle when the interval changes (the rate crossed 1,000/s). */
  function scheduleUpdate(): void {
    const ms = intervalMs()
    if (ms !== throttledMs) {
      throttled.cancel()
      throttledMs = ms
      throttled = throttle(update, ms)
    }
    throttled()
  }

  watch(
    () => messages.revision(id.value),
    () => scheduleUpdate()
  )
  watch(paused, () => {
    throttled.cancel()
    update()
  })
  watch([id, filterKey], ([nextId], [previousId]) => {
    view.setPredicate(buildPredicate())
    if (nextId === previousId) {
      // Filter edits (typing) are coalesced like new messages.
      scheduleUpdate()
      return
    }
    // Another connection: never show the previous connection's rows, not even briefly.
    view.reset()
    frozen = null
    rows.value = view.rows
    throttled.cancel()
    update()
  })

  view.setPredicate(buildPredicate())
  update()
  onScopeDispose(() => {
    throttled.cancel()
    nextSlice.cancel()
  })

  return {
    rows,
    total: computed(() => messages.count(id.value)),
    matched: computed(() => rows.value.length),
    paused,
    pending: computed(() => pending.value)
  }
}
