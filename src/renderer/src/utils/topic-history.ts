/**
 * Message history of single topics, maintained incrementally (pure, no Vue).
 *
 * One `FilteredView` per connection, topic and row limit, kept in a small most-recently-used
 * cache per connection (callers with different limits do not evict each other). Internal helper
 * of `useMessagesStore().topicHistory`.
 */
import type { MqttMessage } from '@shared/models'
import { FilteredView } from './filtered-view'
import type { MessageSource } from './message-buffer'

export class TopicHistoryViews {
  private readonly byConnection = new Map<string, Map<string, FilteredView>>()

  /** @param perConnection views kept per connection (most recently used). */
  constructor(private readonly perConnection = 8) {}

  /**
   * The newest `limit` messages of exactly `topic` in `source`, oldest first. The same array
   * is returned until the history changes.
   */
  rows(
    connectionId: string,
    topic: string,
    limit: number,
    source: MessageSource
  ): readonly MqttMessage[] {
    let views = this.byConnection.get(connectionId)
    if (!views) {
      views = new Map()
      this.byConnection.set(connectionId, views)
    }
    const maxRows = Math.max(1, Math.floor(limit))
    const key = `${maxRows}\u0000${topic}`
    let view = views.get(key)
    if (view) views.delete(key)
    else view = new FilteredView((message) => message.topic === topic, { maxRows })
    views.set(key, view) // most recently used last
    if (views.size > this.perConnection) {
      const oldest = views.keys().next().value
      if (oldest !== undefined) views.delete(oldest)
    }
    view.sync(source)
    return view.rows
  }

  /** Drops the views of a connection. */
  delete(connectionId: string): void {
    this.byConnection.delete(connectionId)
  }
}
