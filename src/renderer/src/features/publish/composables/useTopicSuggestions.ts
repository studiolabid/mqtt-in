/**
 * Topic suggestions for the publish topic input: topics published before (history) and
 * recently active topics, filtered as the user types.
 *
 * The source list is a snapshot taken on demand (`refresh()` from event handlers) — never a
 * reactive dependency on the live topic tree, which changes with every message batch.
 */
import { computed, shallowRef, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { usePublishStore } from '@/stores'

export interface TopicSuggestion {
  topic: string
  /** Published from this connection before (otherwise seen in the message stream). */
  published: boolean
}

const MAX_VISIBLE = 50

/**
 * Case-insensitive substring match; topics starting with the query come first, the original
 * order (history first, then most recently active) is kept otherwise. The exact query itself
 * is not suggested.
 */
export function filterSuggestions(
  list: readonly TopicSuggestion[],
  query: string,
  limit = MAX_VISIBLE
): TopicSuggestion[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return list.filter((item) => item.topic !== query).slice(0, limit)
  const prefixed: TopicSuggestion[] = []
  const containing: TopicSuggestion[] = []
  for (const item of list) {
    if (item.topic === query) continue
    const index = item.topic.toLowerCase().indexOf(needle)
    if (index === 0) prefixed.push(item)
    else if (index > 0) containing.push(item)
    if (prefixed.length >= limit) break
  }
  return prefixed.concat(containing).slice(0, limit)
}

export interface TopicSuggestions {
  items: ComputedRef<TopicSuggestion[]>
  /** Re-reads the suggestions of the store (call from event handlers, e.g. on focus). */
  refresh(): void
}

export function useTopicSuggestions(
  connectionId: MaybeRefOrGetter<string>,
  query: MaybeRefOrGetter<string>
): TopicSuggestions {
  const publish = usePublishStore()
  const source = shallowRef<TopicSuggestion[]>([])

  function refresh(): void {
    const id = toValue(connectionId)
    const published = new Set(publish.history(id).map((item) => item.topic))
    source.value = publish
      .topicSuggestions(id)
      .map((topic) => ({ topic, published: published.has(topic) }))
  }

  const items = computed(() => filterSuggestions(source.value, toValue(query)))
  return { items, refresh }
}
