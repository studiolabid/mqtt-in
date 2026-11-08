/**
 * A local text model that writes to a store field after a pause in typing (and immediately
 * when cleared). External changes of the field (reset, "filter by this topic"…) replace the
 * local text, cancelling a pending write. A pending write is flushed when the scope ends.
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue'

export interface DebouncedModel {
  model: Ref<string>
  /** Writes a pending change now. */
  flush(): void
}

export function useDebouncedModel(
  get: () => string,
  set: (value: string) => void,
  delayMs = 150
): DebouncedModel {
  const model = ref(get())
  let timer: ReturnType<typeof setTimeout> | undefined

  function commit(): void {
    timer = undefined
    if (get() !== model.value) set(model.value)
  }

  function flush(): void {
    if (timer === undefined) return
    clearTimeout(timer)
    commit()
  }

  watch(model, (value) => {
    clearTimeout(timer)
    timer = undefined
    if (value === '') commit()
    else timer = setTimeout(commit, delayMs)
  })

  watch(get, (value) => {
    if (value === model.value) return
    clearTimeout(timer)
    timer = undefined
    model.value = value
  })

  onScopeDispose(flush)

  return { model, flush }
}
