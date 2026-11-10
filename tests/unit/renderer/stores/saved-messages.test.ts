/**
 * Saved messages: names (replace on a taken one), never retained, removal with undo, and the
 * persistence (debounced, untrusted on load, never written after a failed load).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAVED_MESSAGES_KEY, useSavedMessagesStore } from '@/stores/saved-messages'
import type { SavedMessage } from '@/types'
import { createPublishDraft } from '@/utils/publish'
import { MAX_SAVED_PAYLOAD_CHARS } from '@/utils/saved-messages'
import { setupStores, type StoreSetup } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

const timer = createPublishDraft({
  topic: 'cmd/A00002',
  payload: '{"id":4,"cmd":"timer","min":1}',
  qos: 1,
  retain: true
})

describe('useSavedMessagesStore', () => {
  let setup: StoreSetup

  beforeEach(async () => {
    vi.clearAllMocks()
    setup = await setupStores()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves a draft without retain, with or without its topic', () => {
    const store = useSavedMessagesStore()
    const first = store.save(timer, ' timer1 ', { keepTopic: true })
    expect(first).toMatchObject({ ok: true, replaced: false })
    expect(store.items[0]).toMatchObject({
      name: 'timer1',
      topic: 'cmd/A00002',
      payload: timer.payload,
      qos: 1
    })
    expect(store.items[0]).not.toHaveProperty('retain')
    store.save(timer, 'any', { keepTopic: false })
    expect(store.byName('ANY')?.topic).toBe('')
  })

  it('replaces a message of the same name (any case) and keeps its id', () => {
    const store = useSavedMessagesStore()
    const first = store.save(timer, 'timer1', { keepTopic: true })
    const second = store.save({ ...timer, payload: '{"cmd":"timer","min":5}' }, 'TIMER1', {
      keepTopic: true
    })
    expect(second).toMatchObject({ ok: true, replaced: true })
    expect(store.items).toHaveLength(1)
    if (!first.ok) throw new Error('not saved')
    expect(store.items[0]).toMatchObject({ id: first.saved.id, payload: '{"cmd":"timer","min":5}' })
  })

  it('refuses bad names and oversized payloads', () => {
    const store = useSavedMessagesStore()
    expect(store.save(timer, '', { keepTopic: true })).toMatchObject({ ok: false })
    expect(store.save(timer, 'two words', { keepTopic: true })).toMatchObject({
      ok: false,
      error: 'No spaces: the name is typed in the payload'
    })
    expect(store.save(timer, '/slash', { keepTopic: true })).toMatchObject({ ok: false })
    const big = { ...timer, payload: 'x'.repeat(MAX_SAVED_PAYLOAD_CHARS + 1) }
    expect(store.save(big, 'big', { keepTopic: true })).toMatchObject({ ok: false })
    expect(store.items).toHaveLength(0)
  })

  it('sorts by name and puts a removed message back', () => {
    const store = useSavedMessagesStore()
    store.save(timer, 'out10', { keepTopic: true })
    store.save(timer, 'out2', { keepTopic: true })
    store.save(timer, 'Alarm', { keepTopic: true })
    expect(store.sorted.map((item) => item.name)).toEqual(['Alarm', 'out2', 'out10'])
    const id = store.byName('out2')?.id ?? ''
    const removed = store.remove(id)
    expect(store.byName('out2')).toBeUndefined()
    if (!removed) throw new Error('not removed')
    expect(store.restore(removed)).toBe(true)
    expect(store.byName('out2')?.id).toBe(id)
    // Not twice, and not over a name taken in the meantime.
    expect(store.restore(removed)).toBe(false)
  })

  it('loads stored messages (untrusted) and saves changes debounced', async () => {
    vi.useFakeTimers()
    const stored: unknown[] = [
      { id: 'a', name: 'status', topic: '', payload: '{"cmd":"status"}', retain: true },
      { id: 'b', name: 'status', topic: 'dup', payload: 'x' },
      { id: 'c', name: 'has space', topic: '', payload: 'x' },
      { id: 'd', topic: '', payload: 'no name' },
      'junk'
    ]
    setup.bridge.storage.set(SAVED_MESSAGES_KEY, stored)
    const store = useSavedMessagesStore()
    await store.load()
    expect(store.items.map((item: SavedMessage) => item.id)).toEqual(['a'])
    expect(store.items[0]).not.toHaveProperty('retain')
    expect(setup.bridge.api.storage.set).not.toHaveBeenCalled()

    store.save(timer, 'timer1', { keepTopic: true })
    await vi.advanceTimersByTimeAsync(600)
    const written = setup.bridge.storage.get(SAVED_MESSAGES_KEY) as SavedMessage[]
    expect(written.map((item) => item.name)).toEqual(['status', 'timer1'])
  })

  it('never writes after a failed load (stored data is preserved)', async () => {
    vi.useFakeTimers()
    vi.mocked(setup.bridge.api.storage.get).mockRejectedValueOnce(new Error('io'))
    const store = useSavedMessagesStore()
    await expect(store.load()).rejects.toThrow('io')
    store.save(timer, 'timer1', { keepTopic: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(setup.bridge.api.storage.set).not.toHaveBeenCalled()
  })
})
