/**
 * Messages received per enabled subscription filter, derived from the live topic tree at most
 * once per `intervalMs`. Cheap: the tree walk only visits branches a filter can match, and
 * nothing is computed per message.
 */
import {
  computed,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef
} from 'vue'
import { useMessagesStore, useSubscriptionsStore } from '@/stores'
import { throttle } from '@/utils/throttle'
import { matchFilter } from '../utils/topic-match'

function sameCounts(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [key, value] of a) if (b.get(key) !== value) return false
  return true
}

/** Subscription id → matching messages received (ids with no messages are absent). */
export function useSubscriptionCounts(
  connectionId: MaybeRefOrGetter<string>,
  intervalMs = 1000
): ShallowRef<ReadonlyMap<string, number>> {
  const messages = useMessagesStore()
  const subscriptions = useSubscriptionsStore()
  const id = computed(() => toValue(connectionId))
  const counts = shallowRef<ReadonlyMap<string, number>>(new Map())

  /** Changes only when an enabled filter is added, removed or edited. */
  const filtersKey = computed(() =>
    subscriptions
      .list(id.value)
      .filter((sub) => sub.enabled)
      .map((sub) => `${sub.id}\u0000${sub.topic}`)
      .join('\u0001')
  )

  // Runs from watcher callbacks only, so reading the tree never tracks the revision.
  function update(): void {
    const tree = messages.topicTree(id.value)
    const next = new Map<string, number>()
    if (tree.topicCount > 0) {
      for (const sub of subscriptions.list(id.value)) {
        if (!sub.enabled) continue
        const received = matchFilter(tree, sub.topic).messages
        if (received > 0) next.set(sub.id, received)
      }
    }
    if (!sameCounts(counts.value, next)) counts.value = next
  }

  const scheduleUpdate = throttle(update, intervalMs)

  watch(
    () => messages.revision(id.value),
    () => scheduleUpdate()
  )
  watch(
    [id, filtersKey],
    () => {
      scheduleUpdate.cancel()
      update()
    },
    { immediate: true }
  )
  onScopeDispose(() => scheduleUpdate.cancel())

  return counts
}
