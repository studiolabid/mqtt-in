/**
 * Which placeholder the message panel shows instead of the list (pure, no Vue).
 */
import type { ConnectionStatus } from '@shared/models'
import type { MessageEmptyKind } from '../types'

export interface EmptyKindInput {
  /** Rows the list shows now. */
  rows: number
  /** Messages in the connection's buffer. */
  total: number
  status: ConnectionStatus
  /** Any enabled subscription. */
  listening: boolean
  filterActive: boolean
  /** A re-filtering pass is still running (`MessageList.pending`). */
  pending: boolean
  paused: boolean
}

/**
 * The empty state for the panel, or null to show the list. A filter only says "none of them
 * match" once its re-filtering pass has ended: the pass fills the rows newest first, so a term
 * that matches only older messages finds them last.
 */
export function messageEmptyKind(input: EmptyKindInput): MessageEmptyKind | null {
  if (input.rows > 0) return null
  if (input.total === 0) {
    if (input.status === 'connecting' || input.status === 'reconnecting') return 'connecting'
    if (input.status !== 'connected') return 'disconnected'
    return input.listening ? 'waiting' : 'no-subscriptions'
  }
  if (input.filterActive) return input.pending ? null : 'filtered'
  if (input.paused) return 'paused'
  // Rows lag the buffer by one throttle interval: keep showing the (empty) list meanwhile.
  return null
}
