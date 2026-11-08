/**
 * Live "matches N of M known topics" preview of a topic filter, recomputed when the filter
 * changes and at most once per second while messages arrive.
 */
import { onScopeDispose, shallowRef, watch, type ShallowRef } from 'vue'
import { useMessagesStore } from '@/stores'
import { throttle } from '@/utils/throttle'
import { matchFilter, type FilterMatch } from '../utils/topic-match'

export interface FilterPreview extends FilterMatch {
  /** Distinct topics received on the connection. */
  known: number
}

const SAMPLE_LIMIT = 3

/**
 * `connectionId` / `filter` return null while there is nothing to preview (dialog closed,
 * invalid filter…). The preview is null until the connection received at least one topic.
 */
export function useFilterPreview(
  connectionId: () => string | null,
  filter: () => string | null,
  intervalMs = 1000
): ShallowRef<FilterPreview | null> {
  const messages = useMessagesStore()
  const preview = shallowRef<FilterPreview | null>(null)

  // Runs from watcher callbacks only, so reading the tree never tracks the revision.
  function refresh(): void {
    const id = connectionId()
    const value = filter()
    if (!id || !value) {
      preview.value = null
      return
    }
    const tree = messages.topicTree(id)
    const known = tree.topicCount
    preview.value = known > 0 ? { ...matchFilter(tree, value, SAMPLE_LIMIT), known } : null
  }

  const refreshSoon = throttle(refresh, intervalMs)

  watch(
    () => {
      const id = connectionId()
      return id ? messages.revision(id) : -1
    },
    () => refreshSoon()
  )
  watch(
    [connectionId, filter],
    () => {
      refreshSoon.cancel()
      refresh()
    },
    { immediate: true }
  )
  onScopeDispose(() => refreshSoon.cancel())

  return preview
}
