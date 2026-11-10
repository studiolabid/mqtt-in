/**
 * Saved messages: publish drafts kept under a short name, shared by every connection
 * (`utils/saved-messages`). Persisted through `api.storage` under `publish.saved` (debounced),
 * loaded by `initApp`; nothing is written before a successful load, so a failed read never
 * overwrites what is stored.
 */
import { defineStore } from 'pinia'
import { computed, nextTick, onScopeDispose, ref, toRaw, watch } from 'vue'
import { newId } from '@shared/defaults'
import { api } from '@/services/api'
import type { PublishDraft, SavedMessage } from '@/types'
import {
  findSavedByName,
  MAX_SAVED_MESSAGES,
  parseSavedMessages,
  savedFromDraft,
  savedNameProblem,
  savedPayloadProblem,
  sortSaved
} from '@/utils/saved-messages'

export const SAVED_MESSAGES_KEY = 'publish.saved'
const SAVE_DELAY_MS = 500

export type SaveResult =
  { ok: true; saved: SavedMessage; replaced: boolean } | { ok: false; error: string }

export const useSavedMessagesStore = defineStore('savedMessages', () => {
  const items = ref<SavedMessage[]>([])
  /** Sorted by name. */
  const sorted = computed(() => sortSaved(items.value))
  let writable = false
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(items, schedule, { deep: true })

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

  function get(id: string): SavedMessage | undefined {
    return items.value.find((item) => item.id === id)
  }

  function byName(name: string): SavedMessage | undefined {
    return findSavedByName(items.value, name)
  }

  /**
   * Saves `draft` as `name` (without retain; the topic only with `keepTopic`). A saved message
   * of the same name is replaced and keeps its id.
   */
  function save(draft: PublishDraft, name: string, options: { keepTopic: boolean }): SaveResult {
    const problem = savedNameProblem(name) ?? savedPayloadProblem(draft)
    if (problem) return { ok: false, error: problem }
    const existing = byName(name)
    if (!existing && items.value.length >= MAX_SAVED_MESSAGES) {
      return { ok: false, error: `At most ${MAX_SAVED_MESSAGES} saved messages` }
    }
    const saved = savedFromDraft(draft, {
      id: existing?.id ?? newId(),
      name,
      keepTopic: options.keepTopic
    })
    items.value = existing
      ? items.value.map((item) => (item.id === existing.id ? saved : item))
      : [...items.value, saved]
    return { ok: true, saved, replaced: existing !== undefined }
  }

  /** Removes a saved message and returns it (for an undo through `restore`). */
  function remove(id: string): SavedMessage | undefined {
    const removed = get(id)
    if (removed) items.value = items.value.filter((item) => item.id !== id)
    return removed
  }

  /** Puts a removed message back, unless its name has been taken since. */
  function restore(saved: SavedMessage): boolean {
    if (byName(saved.name) || get(saved.id) || items.value.length >= MAX_SAVED_MESSAGES) {
      return false
    }
    items.value = [...items.value, saved]
    return true
  }

  function schedule(): void {
    if (!writable) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }

  async function flush(): Promise<void> {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    try {
      await api.storage.set(SAVED_MESSAGES_KEY, toRaw(items.value))
    } catch (err) {
      console.warn('[mqtt-in] could not save the saved messages:', err)
    }
  }

  /** Reads the stored messages; ones saved before the load finished win on a name clash. */
  async function load(): Promise<void> {
    let ok = false
    let savedEarlier: boolean
    try {
      const stored = parseSavedMessages(await api.storage.get<unknown>(SAVED_MESSAGES_KEY))
      const current = toRaw(items.value)
      savedEarlier = current.length > 0
      const kept = stored.filter((item) => !findSavedByName(current, item.name))
      items.value = [...kept, ...current].slice(0, MAX_SAVED_MESSAGES)
      ok = true
    } finally {
      // The watcher must not write the loaded list straight back.
      await nextTick()
      writable = ok
    }
    if (savedEarlier) schedule()
  }

  return { items, sorted, get, byName, save, remove, restore, load, flush }
})
