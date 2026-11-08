/**
 * The toolbar's "Searching…" state: true while the message list re-filters a large buffer
 * (`MessageList.pending`, slice by slice), but only once a pass has taken longer than `delayMs`.
 * Quick passes (small buffers, every keystroke) never flash a spinner; the state clears as soon
 * as the pass ends.
 */
import { onScopeDispose, readonly, ref, watch, type Ref } from 'vue'

/** A pass shorter than this shows no indicator. */
export const SEARCHING_DELAY_MS = 150

export function useSearching(
  pending: () => boolean,
  delayMs = SEARCHING_DELAY_MS
): Readonly<Ref<boolean>> {
  const searching = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  function stopTimer(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  watch(
    pending,
    (busy) => {
      if (!busy) {
        stopTimer()
        searching.value = false
      } else if (!searching.value && timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined
          searching.value = true
        }, delayMs)
      }
    },
    { immediate: true }
  )
  onScopeDispose(stopTimer)

  return readonly(searching)
}
