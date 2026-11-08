/**
 * Dirty tracking for the connection form: a stable text snapshot of the fields the dialog owns.
 */
import type { ConnectionProfile } from '@shared/models'

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    if (record[key] !== undefined) out[key] = normalize(record[key])
  }
  return out
}

/** JSON with sorted keys and without `undefined` members (`NaN` is kept distinguishable). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value))
}

/**
 * Snapshot of the fields edited by the dialog. Subscriptions and bookkeeping timestamps are
 * left out: they are not edited here and may change in the background.
 */
export function formSnapshot(profile: ConnectionProfile): string {
  const fields: Partial<ConnectionProfile> = { ...profile }
  delete fields.subscriptions
  delete fields.createdAt
  delete fields.updatedAt
  delete fields.lastConnectedAt
  return stableStringify(fields)
}
