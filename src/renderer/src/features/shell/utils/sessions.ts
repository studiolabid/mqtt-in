/**
 * Pure helpers for the shell's session overview (status bar, command palette).
 */
import type { ConnectionProfile, ConnectionStatus } from '@shared/models'

export interface ActiveSession {
  connectionId: string
  name: string
  status: ConnectionStatus
}

export interface SessionSummary {
  connected: number
  /** connecting / reconnecting / disconnecting */
  pending: number
  failed: number
  /** Non-idle sessions: connected first, then pending, then failed (sidebar order inside). */
  active: ActiveSession[]
}

const RANK: Record<ConnectionStatus, number> = {
  connected: 0,
  connecting: 1,
  reconnecting: 1,
  disconnecting: 1,
  error: 2,
  disconnected: 3
}

/** Summarizes the sessions of saved profiles (sessions of deleted profiles are ignored). */
export function summarizeSessions(
  profiles: readonly Pick<ConnectionProfile, 'id' | 'name'>[],
  statusOf: (connectionId: string) => ConnectionStatus
): SessionSummary {
  const summary: SessionSummary = { connected: 0, pending: 0, failed: 0, active: [] }
  for (const profile of profiles) {
    const status = statusOf(profile.id)
    if (status === 'disconnected') continue
    if (status === 'connected') summary.connected++
    else if (status === 'error') summary.failed++
    else summary.pending++
    summary.active.push({ connectionId: profile.id, name: profile.name, status })
  }
  // Array.prototype.sort is stable: the sidebar order is kept inside each rank.
  summary.active.sort((a, b) => RANK[a.status] - RANK[b.status])
  return summary
}

export interface SummaryPart {
  kind: 'connected' | 'pending' | 'failed'
  text: string
}

/** `2 connected`, `1 connecting`, `1 failed` (only the non-zero ones). */
export function sessionSummaryParts(summary: SessionSummary): SummaryPart[] {
  const parts: SummaryPart[] = []
  if (summary.connected > 0)
    parts.push({ kind: 'connected', text: `${summary.connected} connected` })
  if (summary.pending > 0) parts.push({ kind: 'pending', text: `${summary.pending} connecting` })
  if (summary.failed > 0) parts.push({ kind: 'failed', text: `${summary.failed} failed` })
  return parts
}

/** `2 connected · 1 connecting · 1 failed`, or `No active connections`. */
export function sessionSummaryText(summary: SessionSummary): string {
  const parts = sessionSummaryParts(summary)
  return parts.length > 0 ? parts.map((part) => part.text).join(' · ') : 'No active connections'
}
