/**
 * Sidebar search: filters profiles by name / host:port / group (matches are highlighted with
 * `HighlightText`).
 */
import type { ConnectionProfile } from '@shared/models'
import type { ConnectionGroup } from '@/types'

/** Lower-case search terms (every term must match: `emqx wss`). */
export function searchTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
}

export function matchesProfile(profile: ConnectionProfile, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const haystack = `${profile.name}\n${profile.host}:${profile.port}\n${profile.group}`
  const lower = haystack.toLowerCase()
  return terms.every((term) => lower.includes(term))
}

/** Groups reduced to their matching profiles; empty groups are dropped. */
export function filterGroups(
  groups: readonly ConnectionGroup[],
  terms: readonly string[]
): ConnectionGroup[] {
  if (terms.length === 0) return [...groups]
  return groups
    .map((group) => ({
      name: group.name,
      profiles: group.profiles.filter((profile) => matchesProfile(profile, terms))
    }))
    .filter((group) => group.profiles.length > 0)
}
