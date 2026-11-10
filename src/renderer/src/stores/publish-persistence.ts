/**
 * Persistence of publish drafts and history through `api.storage` (debounced 500 ms).
 * Internal helper of `usePublishStore`; runs inside the store's effect scope.
 */
import { nextTick, onScopeDispose, ref, toRaw, watch, type Ref } from 'vue'
import { utf8Encode } from '@shared/payload'
import type { PublishDraft, PublishHistoryItem } from '@/types'
import { api } from '@/services/api'
import { parseDraft, parseHistoryItem } from '@/utils/publish'

export const DRAFTS_KEY = 'publish.drafts'
export const HISTORY_KEY = 'publish.history'
const SAVE_DELAY_MS = 500
/** Drafts / history entries with larger payloads stay in memory but are not written to disk. */
const MAX_PERSISTED_PAYLOAD_CHARS = 256 * 1024
/**
 * Budget of one stored value. The main process refuses values over 2 MB of UTF-8 JSON, which
 * would silently stop every later save, so the oldest entries that do not fit stay in memory.
 */
export const MAX_PERSISTED_BYTES = 1536 * 1024
const MAX_HISTORY_PER_CONNECTION = 100

type Key = 'drafts' | 'history'

export interface PublishState {
  drafts: Ref<Record<string, PublishDraft>>
  history: Ref<Record<string, PublishHistoryItem[]>>
}

export interface PublishPersistence {
  /** True once `load()` finished. */
  readonly loaded: Ref<boolean>
  /**
   * Reads drafts and history; entries already in memory win over stored ones. Changes are
   * written only after a successful load, so a failed read never overwrites stored data.
   */
  load(): Promise<void>
  /** Writes pending changes now. */
  flush(): Promise<void>
}

export function createPublishPersistence(state: PublishState): PublishPersistence {
  const loaded = ref(false)
  let writable = false
  const dirty = new Set<Key>()
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(state.drafts, () => schedule('drafts'), { deep: true })
  watch(state.history, () => schedule('history'), { deep: true })

  const onUnload = (): void => void flush()
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', onUnload)
  }
  onScopeDispose(() => {
    if (timer !== undefined) clearTimeout(timer)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('beforeunload', onUnload)
    }
  })

  function schedule(key: Key): void {
    if (!writable) return
    dirty.add(key)
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }

  async function flush(): Promise<void> {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    const keys = Array.from(dirty)
    dirty.clear()
    await Promise.all(keys.map(write))
  }

  async function write(key: Key): Promise<void> {
    try {
      if (key === 'drafts') await api.storage.set(DRAFTS_KEY, serializeDrafts(state.drafts.value))
      else await api.storage.set(HISTORY_KEY, serializeHistory(state.history.value))
    } catch (err) {
      console.warn(`[mqtt-in] could not save publish ${key}:`, err)
    }
  }

  async function load(): Promise<void> {
    let ok = false
    try {
      const [rawDrafts, rawHistory] = await Promise.all([
        api.storage.get<unknown>(DRAFTS_KEY),
        api.storage.get<unknown>(HISTORY_KEY)
      ])
      state.drafts.value = { ...parseDrafts(rawDrafts), ...toRaw(state.drafts.value) }
      state.history.value = { ...parseHistory(rawHistory), ...toRaw(state.history.value) }
      ok = true
    } finally {
      // Let the watchers see the loaded state first: it must not be written straight back.
      await nextTick()
      loaded.value = true
      writable = ok
    }
  }

  return { loaded, load, flush }
}

/**
 * Stored drafts, always with retain off: a Retain left on in an earlier session must not make
 * the first publish of this one a retained message.
 */
function parseDrafts(raw: unknown): Record<string, PublishDraft> {
  const out: Record<string, PublishDraft> = {}
  if (!isRecord(raw)) return out
  for (const [id, value] of Object.entries(raw)) {
    const draft = parseDraft(value)
    if (draft) out[id] = { ...draft, retain: false }
  }
  return out
}

function parseHistory(raw: unknown): Record<string, PublishHistoryItem[]> {
  const out: Record<string, PublishHistoryItem[]> = {}
  if (!isRecord(raw)) return out
  for (const [id, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue
    const items = value
      .map(parseHistoryItem)
      .filter((item): item is PublishHistoryItem => item !== null)
      .slice(0, MAX_HISTORY_PER_CONNECTION)
    if (items.length > 0) out[id] = items
  }
  return out
}

/** UTF-8 size of `value` as JSON (what the main process measures). */
function jsonBytes(value: unknown): number {
  return utf8Encode(JSON.stringify(value) ?? '').byteLength
}

/** The drafts that fit the storage budget. */
function serializeDrafts(drafts: Record<string, PublishDraft>): Record<string, PublishDraft> {
  const out: Record<string, PublishDraft> = {}
  let budget = MAX_PERSISTED_BYTES
  for (const [id, draft] of Object.entries(drafts)) {
    if (draft.payload.length > MAX_PERSISTED_PAYLOAD_CHARS) continue
    const size = jsonBytes(draft)
    if (size > budget) continue
    budget -= size
    out[id] = draft
  }
  return out
}

/** The history entries that fit the storage budget: the newest win, across connections. */
function serializeHistory(
  history: Record<string, PublishHistoryItem[]>
): Record<string, PublishHistoryItem[]> {
  const entries = Object.entries(history).flatMap(([id, items]) =>
    items.map((item, index) => ({ key: `${id}\u0000${index}`, item }))
  )
  entries.sort((a, b) => b.item.timestamp - a.item.timestamp)
  const kept = new Set<string>()
  let budget = MAX_PERSISTED_BYTES
  for (const { key, item } of entries) {
    if (item.payload.length > MAX_PERSISTED_PAYLOAD_CHARS) continue
    const size = jsonBytes(item)
    if (size > budget) continue
    budget -= size
    kept.add(key)
  }
  const out: Record<string, PublishHistoryItem[]> = {}
  for (const [id, items] of Object.entries(history)) {
    const list = items.filter((_item, index) => kept.has(`${id}\u0000${index}`))
    if (list.length > 0) out[id] = list
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
