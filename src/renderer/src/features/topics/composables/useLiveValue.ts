/**
 * A value derived from a connection's live message data, re-read at most every `throttleMs`
 * while messages arrive and frozen while the connection's views are paused.
 */
import {
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef
} from 'vue'
import { useMessagesStore } from '@/stores/messages'
import { throttle } from '@/utils/throttle'

export interface LiveValueOptions<T> {
  /** Changes of this key re-read immediately (e.g. the selected topic). */
  key?: () => unknown
  /** Minimum time between two reads under load. Default 250 ms. */
  throttleMs?: number
  /** Keeps the previous value (no update downstream) when it is equivalent to the new one. */
  equals?: (previous: T, next: T) => boolean
}

/**
 * Keeps `read()` in a shallow ref. `read` runs outside of any effect, so reading store getters
 * inside it does not subscribe to every message batch; updates are driven by the connection's
 * revision instead.
 */
export function useLiveValue<T>(
  connectionId: MaybeRefOrGetter<string>,
  read: () => T,
  options: LiveValueOptions<T> = {}
): ShallowRef<T> {
  const messages = useMessagesStore()
  const value = shallowRef<T>(read())

  function update(): void {
    const next = read()
    if (options.equals?.(value.value, next)) return
    value.value = next
  }

  const schedule = throttle(update, options.throttleMs ?? 250)

  watch(
    () => messages.revision(toValue(connectionId)),
    () => {
      if (!messages.isPaused(toValue(connectionId))) schedule()
    }
  )
  watch(
    () => messages.isPaused(toValue(connectionId)),
    (paused) => {
      if (!paused) schedule()
    }
  )
  watch([() => toValue(connectionId), options.key ?? (() => undefined)], () => {
    schedule.cancel()
    update()
  })

  onScopeDispose(() => schedule.cancel())
  return value
}
