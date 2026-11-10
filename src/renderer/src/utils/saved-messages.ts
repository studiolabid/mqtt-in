/**
 * Saved messages (pure, no Vue): names, conversion from and to a publish draft, filtering and
 * the validation of stored data.
 *
 * A saved message is a draft without retain, kept under a short name that is typed in the
 * payload editor (`status` + Tab). It is shared by every connection; an empty topic keeps the
 * topic the draft already has, so one `reboot` message serves every device.
 */
import type { PublishDraft, SavedMessage } from '@/types'
import { createPublishDraft, parseDraft } from './publish'

/** Longest name. */
export const SAVED_NAME_MAX_LENGTH = 40
/** Saved messages kept at most. */
export const MAX_SAVED_MESSAGES = 200
/** Longest payload that can be saved (characters). */
export const MAX_SAVED_PAYLOAD_CHARS = 256 * 1024

/** Why `name` cannot name a saved message, or `null`. A taken name is not a problem: it replaces. */
export function savedNameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Give it a name'
  if (/\s/.test(trimmed)) return 'No spaces: the name is typed in the payload'
  if (trimmed.startsWith('/')) return 'Cannot start with /'
  if (trimmed.length > SAVED_NAME_MAX_LENGTH) {
    return `At most ${SAVED_NAME_MAX_LENGTH} characters`
  }
  return null
}

/** Why `draft` cannot be saved, or `null`. */
export function savedPayloadProblem(draft: Pick<PublishDraft, 'payload'>): string | null {
  return draft.payload.length > MAX_SAVED_PAYLOAD_CHARS
    ? 'The payload is too large to save (max 256 KB)'
    : null
}

/** The saved message named `name` (case-insensitive), if any. */
export function findSavedByName(
  items: readonly SavedMessage[],
  name: string
): SavedMessage | undefined {
  const key = name.trim().toLowerCase()
  return items.find((item) => item.name.toLowerCase() === key)
}

/** A saved message holding `draft` (without retain; without the topic unless `keepTopic`). */
export function savedFromDraft(
  draft: PublishDraft,
  options: { id: string; name: string; keepTopic: boolean }
): SavedMessage {
  const copy = createPublishDraft(draft)
  return {
    id: options.id,
    name: options.name.trim(),
    topic: options.keepTopic ? copy.topic : '',
    payload: copy.payload,
    format: copy.format,
    qos: copy.qos,
    useTemplate: copy.useTemplate,
    properties: copy.properties
  }
}

/** The draft that loads `saved`: its topic or else the current one, and never retained. */
export function draftFromSaved(saved: SavedMessage, current: PublishDraft): PublishDraft {
  return createPublishDraft({
    topic: saved.topic === '' ? current.topic : saved.topic,
    payload: saved.payload,
    format: saved.format,
    qos: saved.qos,
    retain: false,
    useTemplate: saved.useTemplate,
    properties: saved.properties
  })
}

/** Sorted by name (case-insensitive, numbers in order: `out2` before `out10`). */
export function sortSaved(items: readonly SavedMessage[]): SavedMessage[] {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  )
}

/** The items whose name, topic or payload contains `query` (case-insensitive). */
export function filterSaved(items: readonly SavedMessage[], query: string): SavedMessage[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...items]
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.topic.toLowerCase().includes(needle) ||
      item.payload.toLowerCase().includes(needle)
  )
}

/**
 * Parses stored saved messages (storage contents are untrusted): invalid entries, repeated
 * names and anything past `MAX_SAVED_MESSAGES` are dropped; a stored retain flag is ignored.
 */
export function parseSavedMessages(raw: unknown): SavedMessage[] {
  if (!Array.isArray(raw)) return []
  const out: SavedMessage[] = []
  const names = new Set<string>()
  for (const value of raw) {
    if (out.length >= MAX_SAVED_MESSAGES) break
    const draft = parseDraft(value)
    if (!draft || typeof value !== 'object' || value === null) continue
    const { id, name } = value as { id?: unknown; name?: unknown }
    if (typeof id !== 'string' || id === '' || typeof name !== 'string') continue
    if (savedNameProblem(name) !== null || names.has(name.trim().toLowerCase())) continue
    names.add(name.trim().toLowerCase())
    out.push(savedFromDraft(draft, { id, name, keepTopic: true }))
  }
  return out
}
