/**
 * Topic path helpers for the topic explorer (pure).
 */
import { MAX_TREE_DEPTH } from '@/utils/topic-tree'

export interface TopicLevel {
  /** Level name (`''` for an empty level). The last level keeps the rest of very deep topics. */
  name: string
  /** Topic of the tree node for this level. */
  topic: string
}

/**
 * The tree levels of a topic, outermost first — split exactly like `TopicTree` materializes
 * nodes (levels beyond `MAX_TREE_DEPTH` stay together in the last one).
 */
export function topicLevels(topic: string): TopicLevel[] {
  const levels: TopicLevel[] = []
  let start = 0
  for (let depth = 0; ; depth++) {
    const slash = depth < MAX_TREE_DEPTH - 1 ? topic.indexOf('/', start) : -1
    const end = slash === -1 ? topic.length : slash
    levels.push({ name: topic.slice(start, end), topic: topic.slice(0, end) })
    if (slash === -1) return levels
    start = slash + 1
  }
}

/** Topics of every ancestor node, outermost first (the topic itself excluded). */
export function ancestorTopics(topic: string): string[] {
  return topicLevels(topic)
    .slice(0, -1)
    .map((level) => level.topic)
}

/** Filter matching a node and everything below it (`a/b` → `a/b/#`, which also matches `a/b`). */
export function subtreeFilter(topic: string): string {
  return `${topic}/#`
}
