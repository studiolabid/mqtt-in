/**
 * Display helpers for connection profiles and session status (pure, no Vue).
 */
import type { ConnectionProfile, ConnectionStatus } from '@shared/models'
import { connectionKind, KIND_LABELS } from '@shared/connection-kind'
import { brokerUrl, protocolLabel, withFreshIdentity } from '@shared/defaults'
import type { ConnectionGroup } from '@/types'
import { compareNatural } from './compare'

/** `MQTT 5.0`, `MQTT 3.1.1`, `MQTT 3.1` (the shared label table of `@shared/defaults`). */
export { protocolLabel } from '@shared/defaults'

/** Semantic color token of a status (see ARCHITECTURE §5 "Status colors"). */
export type StatusTone = 'success' | 'warning' | 'destructive' | 'muted'

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnecting: 'Disconnecting…',
  error: 'Error'
}

const STATUS_TONES: Record<ConnectionStatus, StatusTone> = {
  disconnected: 'muted',
  connecting: 'warning',
  connected: 'success',
  reconnecting: 'warning',
  disconnecting: 'warning',
  error: 'destructive'
}

/** What the connection speaks: `MQTT 5.0`, `MQTT 3.1.1`, `WebSocket` or `Socket.IO`. */
export function profileTypeLabel(
  profile: Pick<ConnectionProfile, 'kind' | 'protocolVersion'>
): string {
  const kind = connectionKind(profile)
  return kind === 'mqtt' ? protocolLabel(profile.protocolVersion) : KIND_LABELS[kind]
}

/** One-line description, e.g. `mqtt://localhost:1883 · MQTT 5.0`. */
export function profileSummary(
  profile: Pick<
    ConnectionProfile,
    'kind' | 'protocol' | 'host' | 'port' | 'path' | 'protocolVersion'
  >
): string {
  return `${brokerUrl(profile)} · ${profileTypeLabel(profile)}`
}

/** Human label of a session status (`Connected`, `Reconnecting…`). */
export function statusLabel(status: ConnectionStatus): string {
  return STATUS_LABELS[status]
}

/** Color token for status dots and badges. */
export function statusTone(status: ConnectionStatus): StatusTone {
  return STATUS_TONES[status]
}

/** Connected or trying to be (connecting / reconnecting). */
export function isActiveStatus(status: ConnectionStatus): boolean {
  return status === 'connected' || status === 'connecting' || status === 'reconnecting'
}

/** A transition is in progress (connecting / disconnecting / reconnecting). */
export function isBusyStatus(status: ConnectionStatus): boolean {
  return status === 'connecting' || status === 'disconnecting' || status === 'reconnecting'
}

/** Up to two initials for avatars: `Home Broker` → `HB`, `mosquitto` → `MO`, `` → `?`. */
export function connectionInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._\-/]+/)
    .filter((word) => word.length > 0)
  if (words.length === 0) return '?'
  const chars = (word: string): string[] => Array.from(word)
  if (words.length === 1) return chars(words[0]).slice(0, 2).join('').toUpperCase()
  return `${chars(words[0])[0]}${chars(words[1])[0]}`.toUpperCase()
}

/** `base`, or `base 2`, `base 3`… — the first that is not in `existing` (case-insensitive). */
export function uniqueName(base: string, existing: Iterable<string>): string {
  const taken = new Set(Array.from(existing, (name) => name.trim().toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

/** `Connection N` with the first free N from `existing.length + 1` on. */
export function nextConnectionName(existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.trim().toLowerCase()))
  for (let n = existing.length + 1; ; n++) {
    const candidate = `Connection ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

/**
 * Profiles grouped by their trimmed `group`: the ungrouped ones first (name `''`), then the
 * groups in natural order (`Lab 2` before `Lab 10`). Each group keeps the given (sidebar) order.
 */
export function groupProfiles(profiles: readonly ConnectionProfile[]): ConnectionGroup[] {
  const map = new Map<string, ConnectionProfile[]>()
  for (const profile of profiles) {
    const name = profile.group.trim()
    const list = map.get(name)
    if (list) list.push(profile)
    else map.set(name, [profile])
  }
  const names = Array.from(map.keys())
    .filter((name) => name !== '')
    .sort(compareNatural)
  const ungrouped = map.get('')
  return [
    ...(ungrouped ? [{ name: '', profiles: ungrouped }] : []),
    ...names.map((name) => ({ name, profiles: map.get(name) ?? [] }))
  ]
}

/** `ids` first (in that order, unknown and repeated ids ignored), then the rest of `current`. */
export function reorderIds(current: readonly string[], ids: readonly string[]): string[] {
  const known = new Set(current)
  const head: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) continue
    seen.add(id)
    head.push(id)
  }
  return [...head, ...current.filter((id) => !seen.has(id))]
}

/**
 * An unsaved copy of a profile with a unique `<name> copy` name, built by the shared
 * `withFreshIdentity` (the same rule as import, CT-08): new ids for the profile and its
 * subscriptions, fresh timestamps, no `lastConnectedAt`, and a regenerated client id when the
 * old one was generated by mqtt-in, so both profiles can be connected at once (same id = broker
 * client takeover). Custom client ids are kept (they may be required by broker policies).
 */
export function duplicateProfile(
  source: ConnectionProfile,
  existingNames: readonly string[],
  now = Date.now()
): ConnectionProfile {
  return withFreshIdentity(source, { name: uniqueName(`${source.name} copy`, existingNames), now })
}
