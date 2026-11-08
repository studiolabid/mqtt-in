/**
 * Throttled, pause-aware rows of a connection's live topic tree (for the topic explorer).
 *
 * Flattening a large expanded tree is the expensive part (≈14 ms for 48k rows), so it only runs
 * when the rows can differ: another connection or tree, a new node or a topic's first message
 * (`TopicTree.structureVersion`), an expansion change or a new search. When only counts and
 * values changed, the previous rows are handed out again as a new array (same row objects), so
 * views re-read the live counts from `row.node` without a re-flatten.
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
import { useMessagesStore } from '@/stores/messages'
import { throttle } from '@/utils/throttle'
import type { TopicRow, TopicTree } from '@/utils/topic-tree'

export interface TopicTreeRowsOptions {
  /** Minimum time between two updates under load. Default 200 ms. */
  throttleMs?: number
}

export interface TopicTreeRows {
  /**
   * Visible rows (see `TopicTree.flatten`): a new array on every update. Row objects are reused
   * while the structure, expansion and search are unchanged: read counts and values from
   * `row.node` (live) when rendering; for a detail panel use `useMessagesStore().topicNode()`.
   * Every row carries `posInSet` / `setSize` (its position among the siblings shown with it).
   */
  rows: ShallowRef<TopicRow[]>
  /** Distinct topics seen. Updated together with `rows`. */
  topicCount: ShallowRef<number>
  /**
   * Topics with messages that match the search (`topicCount` without a search). Updated
   * together with `rows`.
   */
  matchCount: ShallowRef<number>
}

/**
 * Flattens the topic tree for display. `expanded` holds the topics of expanded nodes (a
 * reactive `Set` may be mutated in place); `search` filters by topic substring.
 */
export function useTopicTreeRows(
  connectionId: MaybeRefOrGetter<string>,
  expanded: MaybeRefOrGetter<ReadonlySet<string>>,
  search: MaybeRefOrGetter<string> = '',
  options: TopicTreeRowsOptions = {}
): TopicTreeRows {
  const messages = useMessagesStore()
  const id = computed(() => toValue(connectionId))
  const rows = shallowRef<TopicRow[]>([])
  const topicCount = shallowRef(0)
  const matchCount = shallowRef(0)
  /** What the current rows were flattened from. */
  let source: { tree: TopicTree; version: number; search: string } | null = null

  /** Re-flattens (`force`) or, when the structure is unchanged, refreshes the counts only. */
  function update(force: boolean): void {
    const tree = messages.topicTree(id.value)
    const term = toValue(search)
    topicCount.value = tree.topicCount
    if (
      !force &&
      source !== null &&
      source.tree === tree &&
      source.version === tree.structureVersion &&
      source.search === term
    ) {
      rows.value = rows.value.slice()
      if (term.trim() === '') matchCount.value = tree.topicCount
      return
    }
    const view = tree.flattenView(toValue(expanded), term)
    source = { tree, version: tree.structureVersion, search: term }
    rows.value = view.rows
    matchCount.value = view.matchCount
  }

  const scheduleUpdate = throttle(() => update(false), options.throttleMs ?? 200)

  watch(
    () => messages.revision(id.value),
    () => {
      if (!messages.isPaused(id.value)) scheduleUpdate()
    }
  )
  watch(
    () => messages.isPaused(id.value),
    (paused) => {
      if (!paused) scheduleUpdate()
    }
  )
  watch([id, () => toValue(search), () => toValue(expanded)], () => update(true), { deep: true })

  update(true)
  onScopeDispose(() => scheduleUpdate.cancel())

  return { rows, topicCount, matchCount }
}
