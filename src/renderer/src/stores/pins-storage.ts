/**
 * Parsing of the persisted pins ('mqtey.pins'). Internal helper of `usePinsStore`.
 */
import type { TopicPin } from './pins'

/**
 * Validates stored pins (storage contents are untrusted): well-formed entries only, at most
 * `maxPerConnection` per connection, one pin per topic + field.
 */
export function parsePins(raw: unknown, maxPerConnection: number): Record<string, TopicPin[]> {
  const out: Record<string, TopicPin[]> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [connectionId, value] of Object.entries(raw)) {
    if (!Array.isArray(value) || connectionId === '__proto__') continue
    const seen = new Set<string>()
    const list: TopicPin[] = []
    for (const item of value) {
      if (list.length >= maxPerConnection) break
      if (typeof item !== 'object' || item === null) continue
      const { id, topic, field } = item as Record<string, unknown>
      if (typeof id !== 'string' || typeof topic !== 'string' || typeof field !== 'string') continue
      const key = `${topic}\u0000${field}`
      if (id === '' || topic === '' || seen.has(key)) continue
      seen.add(key)
      list.push({ id, topic, field })
    }
    if (list.length > 0) out[connectionId] = list
  }
  return out
}
