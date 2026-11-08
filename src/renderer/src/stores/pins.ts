/**
 * Pinned topic values (FP-3, CT-13): a pin is a topic + numeric field of one connection, shown
 * at the top of the topic explorer with its latest value, delta and sparkline.
 *
 * - At most `MAX_PINS_PER_CONNECTION` per connection; persisted through `api.storage` under
 *   'mqtey.pins' (`Record<connectionId, TopicPin[]>`, debounced), loaded by `initApp`.
 * - Every pin owns a ring of the newest `PIN_SERIES_POINTS` points (plain typed arrays, outside
 *   Vue reactivity, ARCHITECTURE §4.2), fed from `useMessagesStore().onIngest` for incoming
 *   messages on pinned topics: one map lookup per message, `extractNumbers` only for pinned
 *   topics. The series therefore survive the message ring buffer's eviction (and a clear).
 *   A new pin is seeded from the messages still in the buffer.
 * - `revision(connectionId)` bumps once per ingested batch that added points; `series()` and
 *   `latest()` read it, so they are reactive.
 * - Pruned through `onConnectionRemoved`.
 */
import { defineStore } from 'pinia'
import { nextTick, onScopeDispose, ref, shallowReactive, toRaw, watch } from 'vue'
import type { MqttMessage } from '@shared/models'
import { newId } from '@shared/defaults'
import { api } from '@/services/api'
import { BARE_NUMBER_FIELD, bareNumber, extractNumbers, numericValue } from '@/utils/numeric'
import { PointRing, type PointSeries } from '@/utils/point-ring'
import { onConnectionRemoved } from './connection-lifecycle'
import { useMessagesStore } from './messages'
import { parsePins } from './pins-storage'

export interface TopicPin {
  id: string
  topic: string
  /** Key from utils/numeric extractNumbers (the keys ChartFieldChips shows); '' = the bare-number payload. */
  field: string
}

/** Points of a pin, oldest first (a copy). */
export type PinSeries = PointSeries

export interface PinLatest {
  value: number
  timestamp: number
  /** The value before it (for the delta), when there is one. */
  previous?: number
}

export const MAX_PINS_PER_CONNECTION = 8
/** Points kept per pin. */
export const PIN_SERIES_POINTS = 2000
export const PINS_STORAGE_KEY = 'mqtey.pins'
const SAVE_DELAY_MS = 500
const NO_PINS: readonly TopicPin[] = Object.freeze([])
const NO_POINTS: PinSeries = Object.freeze({
  times: new Float64Array(0),
  values: new Float64Array(0),
  length: 0
})

export const usePinsStore = defineStore('pins', () => {
  const messages = useMessagesStore()
  const pins = ref<Record<string, TopicPin[]>>({})
  const revisions = shallowReactive<Record<string, number>>({})
  /** Ring per pin id (pin ids are unique across connections). */
  const rings = new Map<string, PointRing>()
  /** connection id → topic → its pins (rebuilt when the pins of a connection change). */
  const byTopic = new Map<string, Map<string, TopicPin[]>>()
  let writable = false
  let timer: ReturnType<typeof setTimeout> | undefined

  onScopeDispose(messages.onIngest(record))
  onScopeDispose(onConnectionRemoved(forget))
  watch(pins, schedule, { deep: true })
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

  /** Pins of a connection in pin order (reactive; do not mutate). */
  function list(connectionId: string): readonly TopicPin[] {
    return pins.value[connectionId] ?? NO_PINS
  }

  /** Whether `topic` (and `field`, when given) is pinned. */
  function isPinned(connectionId: string, topic: string, field?: string): boolean {
    return list(connectionId).some(
      (pin) => pin.topic === topic && (field === undefined || pin.field === field)
    )
  }

  /**
   * Pins a topic field (seeded from the messages still in the buffer). Pinning an already
   * pinned field returns the existing pin.
   *
   * @returns the pin, or null at `MAX_PINS_PER_CONNECTION`.
   */
  function pin(connectionId: string, topic: string, field: string): TopicPin | null {
    const current = list(connectionId)
    const existing = current.find((p) => p.topic === topic && p.field === field)
    if (existing) return existing
    if (current.length >= MAX_PINS_PER_CONNECTION) return null
    const created: TopicPin = { id: newId(), topic, field }
    pins.value[connectionId] = [...current, created]
    rings.set(created.id, seededRing(connectionId, created))
    reindex(connectionId)
    bump(connectionId)
    return list(connectionId).find((p) => p.id === created.id) ?? created
  }

  function unpin(connectionId: string, pinId: string): void {
    const current = list(connectionId)
    if (!current.some((p) => p.id === pinId)) return
    const next = current.filter((p) => p.id !== pinId)
    if (next.length > 0) pins.value[connectionId] = next
    else delete pins.value[connectionId]
    rings.delete(pinId)
    reindex(connectionId)
    bump(connectionId)
  }

  /** Pins or unpins a topic field. @returns whether it is pinned now (false at the limit). */
  function toggle(connectionId: string, topic: string, field: string): boolean {
    const existing = list(connectionId).find((p) => p.topic === topic && p.field === field)
    if (existing) {
      unpin(connectionId, existing.id)
      return false
    }
    return pin(connectionId, topic, field) !== null
  }

  /** The pin's points, oldest first (a copy; reactive via the revision). */
  function series(connectionId: string, pinId: string): PinSeries {
    revision(connectionId)
    return rings.get(pinId)?.series() ?? NO_POINTS
  }

  /** The newest value with its time and the value before it (reactive via the revision). */
  function latest(connectionId: string, pinId: string): PinLatest | undefined {
    revision(connectionId)
    const ring = rings.get(pinId)
    const last = ring?.at(0)
    if (!ring || !last) return undefined
    const before = ring.at(1)
    const result: PinLatest = { value: last.value, timestamp: last.time }
    if (before) result.previous = before.value
    return result
  }

  /** Bumps once per ingested batch that added points (and when the pins change). */
  function revision(connectionId: string): number {
    return revisions[connectionId] ?? 0
  }

  /** Loads the persisted pins (called once by `initApp`); a failed read never overwrites them. */
  async function load(): Promise<void> {
    let ok = false
    try {
      const raw = await api.storage.get<unknown>(PINS_STORAGE_KEY)
      const stored = parsePins(raw, MAX_PINS_PER_CONNECTION)
      for (const [connectionId, loaded] of Object.entries(stored)) {
        if (connectionId in toRaw(pins.value)) continue // pinned meanwhile: keep the session's
        pins.value[connectionId] = loaded
        for (const p of loaded) rings.set(p.id, seededRing(connectionId, p))
        reindex(connectionId)
        bump(connectionId)
      }
      ok = true
    } finally {
      await nextTick() // the watcher must not write the loaded state straight back
      writable = ok
    }
  }

  /** Writes pending changes now. */
  async function flush(): Promise<void> {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!writable) return
    try {
      await api.storage.set(PINS_STORAGE_KEY, pins.value)
    } catch (err) {
      console.warn('[mqtey] could not save the pinned values:', err)
    }
  }

  /** Drops the pins of connections that no longer exist (after a reliable load). */
  function prune(validIds: ReadonlySet<string>): void {
    for (const id of Object.keys(pins.value)) if (!validIds.has(id)) forget(id)
  }

  /** Drops the pins of a deleted connection (registered with `onConnectionRemoved`). */
  function forget(connectionId: string): void {
    for (const p of list(connectionId)) rings.delete(p.id)
    delete pins.value[connectionId]
    byTopic.delete(connectionId)
    delete revisions[connectionId]
  }

  // --- Internals -------------------------------------------------------------

  function schedule(): void {
    if (!writable) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }

  function bump(connectionId: string): void {
    revisions[connectionId] = revision(connectionId) + 1
  }

  function reindex(connectionId: string): void {
    const index = new Map<string, TopicPin[]>()
    for (const p of toRaw(list(connectionId))) {
      const plain = toRaw(p)
      const group = index.get(plain.topic)
      if (group) group.push(plain)
      else index.set(plain.topic, [plain])
    }
    if (index.size > 0) byTopic.set(connectionId, index)
    else byTopic.delete(connectionId)
  }

  /** Feeds the rings of the pinned topics of an ingested batch. */
  function record(connectionId: string, batch: readonly MqttMessage[]): void {
    const topics = byTopic.get(connectionId)
    if (!topics) return
    let added = false
    for (const message of batch) {
      if (message.direction !== 'in') continue
      const pinned = topics.get(message.topic)
      if (pinned && addPoints(message, pinned)) added = true
    }
    if (added) bump(connectionId)
  }

  /** Adds the message's value to each pin's ring; parses the payload at most once per kind. */
  function addPoints(message: MqttMessage, pinned: readonly TopicPin[]): boolean {
    let fields: Record<string, number> | null | undefined
    let bare: number | null | undefined
    let added = false
    for (const p of pinned) {
      let value: number | null
      if (p.field === BARE_NUMBER_FIELD) {
        if (bare === undefined) bare = bareNumber(message.payload)
        value = bare
      } else {
        if (fields === undefined) fields = extractNumbers(message.payload)
        value = fields && Object.hasOwn(fields, p.field) ? fields[p.field] : null
      }
      const ring = rings.get(p.id)
      if (value === null || !ring) continue
      ring.push(message.timestamp, value)
      added = true
    }
    return added
  }

  /** A ring filled with the pin's values among the messages still in the buffer. */
  function seededRing(connectionId: string, p: TopicPin): PointRing {
    const ring = new PointRing(PIN_SERIES_POINTS)
    const { topic, field } = toRaw(p)
    for (const message of messages.sourceOf(connectionId).messages) {
      if (message.direction !== 'in' || message.topic !== topic) continue
      const value = numericValue(message.payload, field)
      if (value !== null) ring.push(message.timestamp, value)
    }
    return ring
  }

  return {
    list,
    isPinned,
    pin,
    unpin,
    toggle,
    series,
    latest,
    revision,
    load,
    flush,
    prune,
    forget
  }
})
