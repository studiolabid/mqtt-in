/**
 * "Recent connections" of the welcome screen (pure).
 */
import type { ConnectionProfile } from '@shared/models'

/**
 * The `limit` most recently connected profiles; profiles never connected follow, the most
 * recently edited first (so a fresh install with saved profiles still lists them).
 */
export function recentProfiles(
  profiles: readonly ConnectionProfile[],
  limit = 5
): ConnectionProfile[] {
  return [...profiles]
    .sort(
      (a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0) || b.updatedAt - a.updatedAt
    )
    .slice(0, Math.max(0, limit))
}
