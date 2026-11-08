import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isReactive } from 'vue'
import { toast } from 'vue-sonner'
import { utf8Decode } from '@shared/payload'
import { useMessagesStore } from '@/stores/messages'
import { MAX_PUBLISH_HISTORY, usePublishStore } from '@/stores/publish'
import { DRAFTS_KEY, HISTORY_KEY, MAX_PERSISTED_BYTES } from '@/stores/publish-persistence'
import type { PublishDraft, PublishHistoryItem } from '@/types'
import { message, utf8 } from '../helpers'
import { setupStores, type StoreSetup } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

describe('usePublishStore', () => {
  let setup: StoreSetup
  let v5: string
  let v4: string

  beforeEach(async () => {
    vi.clearAllMocks()
    setup = await setupStores([
      { name: 'Five', protocolVersion: 5 },
      { name: 'Four', protocolVersion: 4 }
    ])
    v5 = setup.profiles[0].id
    v4 = setup.profiles[1].id
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('creates reactive drafts with defaults on demand', () => {
    const store = usePublishStore()
    const draft = store.draft(v5)
    expect(isReactive(draft)).toBe(true)
    expect(draft).toMatchObject({
      topic: 'mqtt-in/test',
      format: 'json',
      qos: 0,
      useTemplate: true
    })
    draft.topic = 'edited'
    expect(store.draft(v5).topic).toBe('edited')
    store.updateDraft(v5, { qos: 2, retain: true })
    expect(store.draft(v5)).toMatchObject({ topic: 'edited', qos: 2, retain: true })
    store.resetDraft(v5)
    expect(store.draft(v5).topic).toBe('mqtt-in/test')
  })

  it('publishes the rendered draft and records it in the history', async () => {
    const store = usePublishStore()
    store.updateDraft(v4, {
      topic: 'a/b',
      payload: 'n={{counter}}',
      format: 'text',
      properties: { contentType: 'text/plain', userProperties: [] }
    })
    await expect(store.publish(v4)).resolves.toBe(true)
    const [connectionId, request] = vi.mocked(setup.bridge.api.mqtt.publish).mock.calls[0]
    expect(connectionId).toBe(v4)
    expect(request.topic).toBe('a/b')
    expect(utf8Decode(request.payload)).toBe('n=1')
    // MQTT 3.1.1: no properties.
    expect(request).not.toHaveProperty('properties')

    const history = store.history(v4)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ topic: 'a/b', payload: 'n={{counter}}' })
    // Publishing the same thing again does not duplicate the newest entry.
    await store.publish(v4)
    expect(store.history(v4)).toHaveLength(1)
    await store.publish(v4, { qos: 1 })
    expect(store.history(v4).map((item) => item.qos)).toEqual([1, 0])
  })

  it('sends MQTT 5 properties to MQTT 5 brokers', async () => {
    const store = usePublishStore()
    store.updateDraft(v5, {
      properties: { contentType: 'application/json', responseTopic: '', userProperties: [] }
    })
    await store.publish(v5)
    const request = vi.mocked(setup.bridge.api.mqtt.publish).mock.calls[0][1]
    expect(request.properties).toEqual({ contentType: 'application/json' })
  })

  it('validates before publishing', async () => {
    const store = usePublishStore()
    store.updateDraft(v5, { topic: 'a/+' })
    await expect(store.publish(v5)).resolves.toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Wildcards (+, #) are not allowed when publishing')
    store.updateDraft(v5, { topic: 'ok', payload: '{oops', useTemplate: false })
    await expect(store.publish(v5)).resolves.toBe(false)
    expect(vi.mocked(toast.error).mock.calls[1][0]).toMatch(/^Invalid JSON/)
    expect(setup.bridge.api.mqtt.publish).not.toHaveBeenCalled()
    expect(store.history(v5)).toEqual([])
  })

  it('shows a toast when the broker refuses', async () => {
    const store = usePublishStore()
    vi.mocked(setup.bridge.api.mqtt.publish).mockRejectedValueOnce(
      new Error("Error invoking remote method 'mqtt:publish': Error: Not connected")
    )
    await expect(store.publish(v5)).resolves.toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Publish failed', { description: 'Not connected' })
  })

  it(`keeps at most ${MAX_PUBLISH_HISTORY} history entries per connection`, async () => {
    const store = usePublishStore()
    for (let i = 0; i < MAX_PUBLISH_HISTORY + 5; i++) {
      await store.publish(v5, { topic: `t/${i}`, payload: '1', format: 'text' })
    }
    expect(store.history(v5)).toHaveLength(MAX_PUBLISH_HISTORY)
    expect(store.history(v5)[0].topic).toBe(`t/${MAX_PUBLISH_HISTORY + 4}`)
    const id = store.history(v5)[1].id
    store.removeHistoryItem(v5, id)
    expect(store.history(v5).some((item) => item.id === id)).toBe(false)
    store.loadFromHistory(v5, store.history(v5)[0].id)
    expect(store.draft(v5).topic).toBe(`t/${MAX_PUBLISH_HISTORY + 4}`)
    store.clearHistory(v5)
    expect(store.history(v5)).toEqual([])
  })

  it('loads a received message into the draft', () => {
    const store = usePublishStore()
    store.loadFromMessage(
      v5,
      message({
        topic: 'x/y',
        qos: 1,
        payload: utf8('{"a":1}'),
        properties: { subscriptionIdentifier: [1], topicAlias: 2, contentType: 'json' }
      })
    )
    expect(store.draft(v5)).toMatchObject({
      topic: 'x/y',
      qos: 1,
      payload: '{\n  "a": 1\n}',
      format: 'json',
      properties: { contentType: 'json', userProperties: [] }
    })
  })

  it('suggests topics from the history and the topic tree', async () => {
    const store = usePublishStore()
    await store.publish(v5, { topic: 'published/one', payload: '1', format: 'text' })
    useMessagesStore().ingest([
      message({ connectionId: v5, topic: 'seen/old', timestamp: 1 }),
      message({ connectionId: v5, topic: 'published/one', timestamp: 2 }),
      message({ connectionId: v5, topic: 'seen/new', timestamp: 3 })
    ])
    expect(store.topicSuggestions(v5)).toEqual(['published/one', 'seen/new', 'seen/old'])
  })

  it('starts repeat jobs with the unrendered draft', async () => {
    const store = usePublishStore()
    store.updateDraft(v5, { topic: 'r', payload: '{"n": {{counter}}}' })
    const jobId = await store.startRepeat(v5, { intervalMs: 1, count: 3.7 })
    expect(jobId).toBe('job-1')
    const [, options] = vi.mocked(setup.bridge.api.mqtt.startRepeat).mock.calls[0]
    expect(options).toMatchObject({
      topic: 'r',
      payload: '{"n": {{counter}}}',
      format: 'json',
      useTemplate: true,
      intervalMs: 10,
      count: 3
    })
    expect(store.activeJobFor(v5)).toMatchObject({ jobId: 'job-1', state: 'running', total: 3 })
    expect(store.jobsFor(v4)).toEqual([])
  })

  it('repeats literal template text when the draft does not use templates', async () => {
    const store = usePublishStore()
    store.updateDraft(v5, { payload: 'raw {{counter}}', format: 'text', useTemplate: false })
    await expect(store.startRepeat(v5, { intervalMs: 100, count: 2 })).resolves.toBe('job-1')
    const [, options] = vi.mocked(setup.bridge.api.mqtt.startRepeat).mock.calls[0]
    expect(options).toMatchObject({ payload: 'raw {{counter}}', useTemplate: false })

    // The up-front check validates the text as authored, not a rendered sample.
    store.updateDraft(v5, { payload: '{"n": {{counter}}}', format: 'json', useTemplate: false })
    await expect(store.startRepeat(v5, { intervalMs: 100, count: 2 })).resolves.toBeNull()
    expect(setup.bridge.api.mqtt.startRepeat).toHaveBeenCalledTimes(1)
  })

  it('refuses repeat jobs that could not encode', async () => {
    const store = usePublishStore()
    store.updateDraft(v5, { payload: '{"n": ', useTemplate: false })
    await expect(store.startRepeat(v5, { intervalMs: 100, count: 0 })).resolves.toBeNull()
    expect(setup.bridge.api.mqtt.startRepeat).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })

  it('tracks repeat job events and stops jobs', async () => {
    const store = usePublishStore()
    const jobId = (await store.startRepeat(v5, { intervalMs: 100, count: 0 })) ?? ''
    const base = { jobId, connectionId: v5, topic: 'mqtt-in/test', total: 0, intervalMs: 100 }
    store.handleRepeat({ ...base, state: 'running', sent: 5, timestamp: Date.now() })
    expect(store.activeJobFor(v5)?.sent).toBe(5)
    await expect(store.stopRepeat(jobId)).resolves.toBe(true)
    expect(store.jobs[jobId].state).toBe('stopped')
    // A late progress event never revives a finished job.
    store.handleRepeat({ ...base, state: 'running', sent: 6, timestamp: Date.now() })
    expect(store.activeJobFor(v5)).toBeUndefined()

    store.handleRepeat({
      ...base,
      jobId: 'j2',
      state: 'error',
      sent: 1,
      error: 'gone',
      timestamp: 1
    })
    expect(toast.error).toHaveBeenCalledWith('Repeat publishing to mqtt-in/test stopped', {
      description: 'gone'
    })
  })

  it('restores persisted drafts and history (ignoring malformed entries)', async () => {
    setup.bridge.storage.set(DRAFTS_KEY, {
      [v5]: { topic: 'saved', payload: 'p', format: 'text' },
      broken: { topic: 1 }
    })
    setup.bridge.storage.set(HISTORY_KEY, {
      [v5]: [{ id: 'h', topic: 'old', payload: 'x' }, 'junk']
    })
    const store = usePublishStore()
    await store.load()
    expect(store.draft(v5).topic).toBe('saved')
    expect(store.history(v5).map((item) => item.id)).toEqual(['h'])
  })

  it('saves changes debounced after loading', async () => {
    vi.useFakeTimers()
    const store = usePublishStore()
    await store.load()
    store.draft(v5).topic = 'first'
    await vi.advanceTimersByTimeAsync(100)
    store.draft(v5).topic = 'second'
    await vi.advanceTimersByTimeAsync(400)
    expect(setup.bridge.api.storage.set).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(setup.bridge.api.storage.set).toHaveBeenCalledTimes(1)
    expect(setup.bridge.storage.get(DRAFTS_KEY)).toMatchObject({ [v5]: { topic: 'second' } })
  })

  it('keeps stored drafts and history under the storage limit (newest history first)', async () => {
    vi.useFakeTimers()
    const store = usePublishStore()
    await store.load()
    // 12 publishes of ~200 KB (~2.4 MB) exceed what one storage value may hold (2 MB).
    const big = 'x'.repeat(200 * 1024)
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(10)
      await store.publish(v5, {
        topic: `big/${i}`,
        payload: `${big}${i}`,
        format: 'text',
        useTemplate: false
      })
    }
    store.draft(v4).payload = 'y'.repeat(300 * 1024) // too large to persist at all
    store.draft(v5).topic = 'kept'
    await vi.advanceTimersByTimeAsync(600)

    const history = setup.bridge.storage.get(HISTORY_KEY) as Record<string, PublishHistoryItem[]>
    expect(new TextEncoder().encode(JSON.stringify(history)).byteLength).toBeLessThanOrEqual(
      MAX_PERSISTED_BYTES + 1024
    )
    const topics = history[v5].map((item) => item.topic)
    expect(topics.length).toBeGreaterThan(5)
    expect(topics.length).toBeLessThan(12)
    expect(topics).toEqual(Array.from({ length: topics.length }, (_, i) => `big/${11 - i}`))
    expect(store.history(v5)).toHaveLength(12) // memory keeps everything

    const drafts = setup.bridge.storage.get(DRAFTS_KEY) as Record<string, PublishDraft>
    expect(drafts[v5]).toMatchObject({ topic: 'kept' })
    expect(drafts).not.toHaveProperty(v4)
    expect(store.draft(v4).payload).toHaveLength(300 * 1024)
  })

  it('never writes after a failed load (stored data is preserved)', async () => {
    vi.useFakeTimers()
    vi.mocked(setup.bridge.api.storage.get).mockRejectedValueOnce(new Error('io'))
    const store = usePublishStore()
    await expect(store.load()).rejects.toThrow('io')
    store.draft(v5).topic = 'changed'
    await vi.advanceTimersByTimeAsync(1000)
    expect(setup.bridge.api.storage.set).not.toHaveBeenCalled()
  })

  it('prunes and forgets connections', async () => {
    const store = usePublishStore()
    store.draft(v5).topic = 'x'
    await store.publish(v4)
    store.prune(new Set([v4]))
    expect(store.draft(v5).topic).toBe('mqtt-in/test')
    expect(store.history(v4)).toHaveLength(1)
    await store.startRepeat(v4, { intervalMs: 100, count: 0 })
    store.forget(v4)
    expect(store.history(v4)).toEqual([])
    expect(store.jobsFor(v4)).toEqual([])
  })

  describe('publish options (CT-14)', () => {
    it('{ history: false } publishes without a history entry', async () => {
      const store = usePublishStore()
      const ok = await store.publish(
        v5,
        { topic: 'a/b', payload: '', format: 'text', retain: true, qos: 1, useTemplate: false },
        { history: false }
      )
      expect(ok).toBe(true)
      expect(setup.bridge.api.mqtt.publish).toHaveBeenCalledWith(
        v5,
        expect.objectContaining({ topic: 'a/b', retain: true, qos: 1 })
      )
      expect(store.history(v5)).toEqual([])
      expect(store.topicSuggestions(v5)).not.toContain('a/b')
    })

    it('passes failures to onError instead of toasting', async () => {
      const store = usePublishStore()
      const onError = vi.fn()
      vi.mocked(setup.bridge.api.mqtt.publish).mockRejectedValueOnce(
        new Error("Error invoking remote method 'mqtt:publish': Error: Not authorized")
      )
      expect(await store.publish(v5, { topic: 'a' }, { onError })).toBe(false)
      expect(onError).toHaveBeenCalledWith('Not authorized')
      // Invalid drafts too.
      expect(await store.publish(v5, { topic: 'a/#' }, { onError })).toBe(false)
      expect(onError).toHaveBeenLastCalledWith('Wildcards (+, #) are not allowed when publishing')
      expect(toast.error).not.toHaveBeenCalled()
      expect(store.history(v5)).toEqual([])
    })
  })
})
