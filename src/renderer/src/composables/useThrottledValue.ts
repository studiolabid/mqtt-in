/**
 * A ref that follows `source` at most once every `intervalMs` (leading + trailing). For display
 * values fed by message batches (counters, rates) that change faster than anyone can read them.
 */
import { onScopeDispose, shallowRef, watch, type ShallowRef } from 'vue'
import { throttle } from '@/utils/throttle'

export function useThrottledValue<T>(source: () => T, intervalMs = 250): Readonly<ShallowRef<T>> {
  const value = shallowRef(source())
  const update = throttle(() => {
    value.value = source()
  }, intervalMs)
  watch(source, () => update())
  onScopeDispose(() => update.cancel())
  return value
}
