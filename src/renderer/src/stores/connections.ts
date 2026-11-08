/**
 * Persisted connection profiles (sidebar order) and their use cases.
 *
 * Saves of the same profile are serialized: `patch()` is a read-modify-write on the latest
 * stored profile, so quick successive edits (e.g. toggling subscriptions) never overwrite each
 * other.
 *
 * This store depends on no other store: deleting a profile announces it through
 * `notifyConnectionRemoved` (see `./connection-lifecycle`), and every store or feature module
 * with per-connection state cleans up there.
 */
import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import { toast } from 'vue-sonner'
import type { ConnectionProfile } from '@shared/models'
import { NEUTRAL_COLOR, newId, normalizeConnectionProfile } from '@shared/defaults'
import { api, errorMessage } from '@/services/api'
import type { ConnectionGroup } from '@/types'
import {
  duplicateProfile,
  groupProfiles,
  nextConnectionName,
  reorderIds,
  uniqueName
} from '@/utils/connection'
import { KeyedQueue } from '@/utils/keyed-queue'
import { toPlain } from '@/utils/plain'
import { notifyConnectionRemoved } from './connection-lifecycle'
import { createConnectionTransfer } from './connection-transfer'

export const useConnectionsStore = defineStore('connections', () => {
  /** Saved profiles in the persisted (sidebar) order. */
  const profiles = ref<ConnectionProfile[]>([])
  /** True once `load()` finished (successfully or not). */
  const loaded = ref(false)
  let markLoaded: () => void = () => {}
  const loadedOnce = new Promise<void>((resolve) => {
    markLoaded = resolve
  })
  /** Saves of one profile run one after the other. */
  const queue = new KeyedQueue()

  const byId = computed(() => new Map(profiles.value.map((profile) => [profile.id, profile])))

  /** Profiles grouped by `group`: ungrouped first (name `''`), then groups in natural order. */
  const groups = computed<ConnectionGroup[]>(() => groupProfiles(profiles.value))

  /** Distinct non-empty group names in natural order (for group pickers). */
  const groupNames = computed(() => groups.value.map((g) => g.name).filter((name) => name !== ''))

  /** Saved profile by id (reactive). */
  function get(id: string): ConnectionProfile | undefined {
    return byId.value.get(id)
  }

  /** Resolves once the first `load()` finished (used by the router guard). */
  function whenLoaded(): Promise<void> {
    return loadedOnce
  }

  /** Loads the saved profiles. Rejects on IPC failure. */
  async function load(): Promise<void> {
    try {
      profiles.value = await api.connections.list()
    } finally {
      loaded.value = true
      markLoaded()
    }
  }

  /**
   * A new, NOT saved profile (for the connection dialog) with a unique name
   * (`Connection N` unless the preset names it) and fresh ids.
   */
  function create(preset: Partial<ConnectionProfile> = {}): ConnectionProfile {
    const overrides = toPlain(preset)
    delete overrides.lastConnectedAt
    const presetName = overrides.name?.trim()
    const now = Date.now()
    // normalizeConnectionProfile deep-merges partial nested presets (tls, will…) over defaults.
    return normalizeConnectionProfile({
      color: NEUTRAL_COLOR,
      ...overrides,
      id: newId(),
      name: presetName ? uniqueName(presetName, names()) : nextConnectionName(names()),
      subscriptions: (overrides.subscriptions ?? []).map((sub) => ({
        ...sub,
        id: newId(),
        createdAt: now
      })),
      createdAt: now,
      updatedAt: now
    })
  }

  /**
   * Inserts or updates a profile and adopts the stored result locally.
   * Rejects with a short, human message.
   */
  function save(profile: ConnectionProfile): Promise<ConnectionProfile> {
    const snapshot = toPlain(profile)
    return queue.run(snapshot.id, () => persist(snapshot))
  }

  /**
   * Serialized read-modify-write of a saved profile: `recipe` receives a plain copy of the
   * latest version (mutate it or return a replacement); the result is saved.
   */
  function patch(
    id: string,
    recipe: (draft: ConnectionProfile) => ConnectionProfile | void
  ): Promise<ConnectionProfile> {
    return queue.run(id, async () => {
      const current = get(id)
      if (!current) throw new Error('Connection not found')
      const draft = toPlain(current)
      return persist(recipe(draft) ?? draft)
    })
  }

  /**
   * Records a successful connect in the local copy. The main process persists
   * `lastConnectedAt` itself on every CONNACK (without touching `updatedAt`), so no save round
   * trip is needed; later saves never lower it (see `persist`).
   */
  function touchLastConnected(id: string, at: number): void {
    const profile = get(id)
    if (profile && (profile.lastConnectedAt ?? 0) < at) profile.lastConnectedAt = at
  }

  /**
   * Deletes the profile. The main process disconnects a live session first (and stops its
   * repeat jobs); once it confirmed, the profile is dropped and `notifyConnectionRemoved(id)`
   * prunes every piece of state that belongs to it (messages, logs, publish draft & history,
   * subscription states, session, UI state, feature state).
   *
   * @returns false (after a toast) when the main process refused.
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await queue.run(id, () => api.connections.remove(id))
    } catch (err) {
      toast.error('Could not delete the connection', { description: errorMessage(err) })
      return false
    }
    profiles.value = profiles.value.filter((profile) => profile.id !== id)
    notifyConnectionRemoved(id)
    return true
  }

  /**
   * Saves a copy (new ids for the profile and its subscriptions, name + " copy") right after
   * the original. Auto-generated client ids are regenerated so both can be connected at once.
   *
   * @returns the saved copy, or null (after a toast) on failure.
   */
  async function duplicate(id: string): Promise<ConnectionProfile | null> {
    const source = get(id)
    if (!source) return null
    try {
      const stored = await save(duplicateProfile(source, names()))
      const ids = profiles.value.map((profile) => profile.id).filter((pid) => pid !== stored.id)
      ids.splice(ids.indexOf(id) + 1, 0, stored.id)
      await reorder(ids)
      return get(stored.id) ?? stored
    } catch (err) {
      toast.error('Could not duplicate the connection', { description: errorMessage(err) })
      return null
    }
  }

  /**
   * Persists a new sidebar order (optimistic). Ids not listed keep their relative order after
   * the listed ones; unknown ids are ignored. Rolls back (with a toast) on failure.
   */
  async function reorder(ids: readonly string[]): Promise<void> {
    const previous = profiles.value.map((profile) => profile.id)
    const next = reorderIds(previous, ids)
    if (next.every((pid, index) => pid === previous[index])) return
    applyOrder(next)
    try {
      await api.connections.reorder(next)
    } catch (err) {
      applyOrder(previous)
      toast.error('Could not save the connection order', { description: errorMessage(err) })
    }
  }

  /**
   * `importFromFile()` / `exportToFile(ids?, options?)` (CT-10) and their busy state
   * (`importing` / `exporting`, shared by every entry point): see `ConnectionTransfer`.
   */
  const { importFromFile, exportToFile, importing, exporting } = createConnectionTransfer({
    get,
    all: () => profiles.value,
    adopt: (profile) => upsert(profile)
  })

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  async function persist(profile: ConnectionProfile): Promise<ConnectionProfile> {
    const local = get(profile.id)
    // A background `touchLastConnected` must never be undone by an older form copy.
    const lastConnectedAt = Math.max(local?.lastConnectedAt ?? 0, profile.lastConnectedAt ?? 0)
    const payload: ConnectionProfile = { ...profile }
    if (lastConnectedAt > 0) payload.lastConnectedAt = lastConnectedAt
    let stored: ConnectionProfile
    try {
      stored = await api.connections.save(payload)
    } catch (err) {
      throw new Error(errorMessage(err), { cause: err })
    }
    upsert(stored)
    return get(stored.id) ?? stored
  }

  function upsert(stored: ConnectionProfile): void {
    const index = profiles.value.findIndex((profile) => profile.id === stored.id)
    if (index === -1) profiles.value.push(stored)
    else profiles.value.splice(index, 1, stored)
  }

  function applyOrder(ids: readonly string[]): void {
    const map = new Map(profiles.value.map((profile) => [profile.id, toRaw(profile)]))
    const ordered = ids.flatMap((pid) => {
      const profile = map.get(pid)
      return profile ? [profile] : []
    })
    // Profiles added while the order was being saved stay at the end.
    for (const profile of map.values()) if (!ids.includes(profile.id)) ordered.push(profile)
    profiles.value = ordered
  }

  function names(): string[] {
    return profiles.value.map((profile) => profile.name)
  }

  return {
    profiles,
    loaded,
    groups,
    groupNames,
    get,
    whenLoaded,
    load,
    create,
    save,
    patch,
    touchLastConnected,
    remove,
    duplicate,
    reorder,
    importing,
    exporting,
    importFromFile,
    exportToFile
  }
})
