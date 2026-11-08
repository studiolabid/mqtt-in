/**
 * "Paused · N new": messages that arrived (in + out) since the view of a connection was paused.
 * The baseline lives outside components so it survives a workspace remount while paused; it is
 * dropped with a deleted connection (`onConnectionRemoved`, CT-11).
 */
import { computed, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { onConnectionRemoved, useMessagesStore } from '@/stores'

/** Connection id → traffic counter (received + sent) when its view was paused. */
const baselines = new Map<string, number>()
onConnectionRemoved((connectionId) => baselines.delete(connectionId))

/** The baselines, read-only (for tests and diagnostics). */
export const pausedBaselines: ReadonlyMap<string, number> = baselines

export function usePausedBacklog(connectionId: MaybeRefOrGetter<string>): ComputedRef<number> {
  const messages = useMessagesStore()

  const id = computed(() => toValue(connectionId))
  const paused = computed(() => messages.isPaused(id.value))
  const traffic = computed(() => {
    const stats = messages.stats(id.value)
    return stats.received + stats.sent
  })

  watch(
    [id, paused],
    ([connection, isPaused]) => {
      if (!isPaused) baselines.delete(connection)
      else if (!baselines.has(connection)) baselines.set(connection, traffic.value)
    },
    { immediate: true }
  )

  // Clearing while paused resets the counters: restart from the new value.
  watch(traffic, (value) => {
    const base = baselines.get(id.value)
    if (base !== undefined && value < base) baselines.set(id.value, value)
  })

  return computed(() => {
    if (!paused.value) return 0
    const base = baselines.get(id.value) ?? traffic.value
    return Math.max(0, traffic.value - base)
  })
}
