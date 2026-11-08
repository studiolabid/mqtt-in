/**
 * FP-1 / MQTT-22 / PRODUCT-04: clearing retained messages publishes empty retained messages at
 * QoS 1 (capped by the broker's Maximum QoS), at most 8 at a time, never into the history,
 * and reports one summary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { toast } from 'vue-sonner'
import type { BrokerInfo, PublishRequest } from '@shared/models'
import { useTopicActions } from '@/features/topics/composables/useTopicActions'
import {
  bulkConfirm,
  clearQos,
  clearSummary,
  progressText,
  runLimited,
  singleConfirm
} from '@/features/topics/utils/clear-retained'
import { useMessagesStore } from '@/stores/messages'
import { usePublishStore } from '@/stores/publish'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import { brokerInfo, message, settle, utf8 } from '../../renderer/helpers'
import { setupStores, type StoreSetup } from '../../renderer/stores/setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => 'progress')
  })
}))

describe('clear-retained texts and helpers', () => {
  it('clears at QoS 1 unless the broker only allows QoS 0', () => {
    expect(clearQos(undefined)).toBe(1)
    expect(clearQos(1)).toBe(1)
    expect(clearQos(0)).toBe(0)
  })

  it('names the first five topics in the bulk confirm', () => {
    const topics = Array.from({ length: 37 }, (_, i) => `a/${i}`)
    const text = bulkConfirm(topics)
    expect(text.title).toBe('Clear 37 retained messages?')
    expect(text.description).toBe(
      '“a/0”, “a/1”, “a/2”, “a/3”, “a/4” and 32 more. Current subscribers receive an empty message on each topic.'
    )
    expect(bulkConfirm(['x']).title).toBe('Clear 1 retained message?')
    expect(bulkConfirm(['x', 'y']).description).not.toContain('more')
  })

  it('says when the retained state is unknown', () => {
    expect(singleConfirm('a/b', false).description).toContain(
      'If the broker keeps a retained message for this topic it is deleted; current subscribers receive an empty message'
    )
    expect(singleConfirm('a/b', true).description).toContain('the broker deletes the message')
  })

  it('summarizes the outcome', () => {
    expect(progressText(12, 37)).toBe('Clearing 12/37…')
    expect(clearSummary(37, [])).toEqual({ ok: true, title: '37 retained messages cleared' })
    expect(clearSummary(37, ['Publish refused: not authorized', 'x'])).toEqual({
      ok: false,
      title: 'Cleared 35 of 37 — 2 failed: Publish refused: not authorized'
    })
  })

  it('runs at most `limit` tasks at once', async () => {
    let running = 0
    let peak = 0
    const done: number[] = []
    await runLimited(
      Array.from({ length: 20 }, (_, i) => i),
      8,
      async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 1))
        running--
      },
      (count) => done.push(count)
    )
    expect(peak).toBe(8)
    expect(done).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })
})

describe('useTopicActions clears', () => {
  let setup: StoreSetup
  let id: string
  let scope: EffectScope
  let inFlight = 0
  let peak = 0

  async function connect(broker: BrokerInfo = brokerInfo()): Promise<void> {
    useSessionsStore().handleStatus({
      connectionId: id,
      status: 'connected',
      timestamp: 1,
      broker
    })
    await settle()
  }

  function seedRetained(count: number): string[] {
    const topics = Array.from({ length: count }, (_, i) => `a/b/${String(i).padStart(2, '0')}`)
    useMessagesStore().ingest(
      topics.map((topic) =>
        message({ connectionId: id, topic, payload: utf8('cfg'), retain: true })
      )
    )
    return topics
  }

  function requests(): PublishRequest[] {
    return vi.mocked(setup.bridge.api.mqtt.publish).mock.calls.map(([, request]) => request)
  }

  /** Starts an action and accepts its confirm dialog. */
  async function confirmed<T>(run: () => Promise<T>): Promise<T> {
    const pending = run()
    await settle()
    useUiStore().resolveConfirm(true)
    return pending
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    setup = await setupStores([{ protocolVersion: 5 }])
    id = setup.profiles[0].id
    scope = effectScope()
    inFlight = 0
    peak = 0
    vi.mocked(setup.bridge.api.mqtt.publish).mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
    })
  })

  afterEach(() => {
    scope.stop()
    vi.unstubAllGlobals()
  })

  it('clears 20 retained topics at QoS 1, 8 at a time, without history', async () => {
    await connect()
    const topics = seedRetained(20)
    const actions = scope.run(() => useTopicActions(id))
    if (!actions) throw new Error('no scope')
    await expect(confirmed(() => actions.clearRetainedBelow('a'))).resolves.toBe(20)
    const sent = requests()
    expect(sent.map((request) => request.topic).sort()).toEqual(topics)
    expect(sent.every((r) => r.retain && r.qos === 1 && r.payload.length === 0)).toBe(true)
    expect(peak).toBeLessThanOrEqual(8)
    expect(peak).toBeGreaterThan(1)
    expect(usePublishStore().history(id)).toHaveLength(0)
    expect(toast.loading).toHaveBeenCalledWith('Clearing 0/20…')
    expect(toast.success).toHaveBeenCalledWith('20 retained messages cleared', { id: 'progress' })
  })

  it('reports a failure in the summary', async () => {
    await connect()
    seedRetained(20)
    vi.mocked(setup.bridge.api.mqtt.publish).mockImplementation(async (_, request) => {
      if (request.topic === 'a/b/07') throw new Error('Publish refused: not authorized')
    })
    const actions = scope.run(() => useTopicActions(id))
    if (!actions) throw new Error('no scope')
    await expect(confirmed(() => actions.clearRetainedBelow('a'))).resolves.toBe(19)
    expect(toast.error).toHaveBeenCalledWith(
      'Cleared 19 of 20 — 1 failed: Publish refused: not authorized',
      expect.objectContaining({ id: 'progress' })
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('clears at QoS 0 when the broker allows no more', async () => {
    await connect(brokerInfo({ maximumQoS: 0 }))
    seedRetained(3)
    const actions = scope.run(() => useTopicActions(id))
    if (!actions) throw new Error('no scope')
    await confirmed(() => actions.clearRetainedBelow('a/b'))
    expect(requests().map((request) => request.qos)).toEqual([0, 0, 0])
  })

  it('clears one topic at QoS 1 without a history entry, and reports a refusal', async () => {
    await connect()
    const actions = scope.run(() => useTopicActions(id))
    if (!actions) throw new Error('no scope')
    await expect(confirmed(() => actions.clearRetained('a/b/c', { known: false }))).resolves.toBe(
      true
    )
    expect(requests()).toMatchObject([{ topic: 'a/b/c', retain: true, qos: 1 }])
    expect(useUiStore().confirmState.options?.description).toContain('If the broker keeps')
    expect(usePublishStore().history(id)).toHaveLength(0)
    expect(toast.success).toHaveBeenCalledWith('Retained message cleared', { description: 'a/b/c' })

    vi.mocked(setup.bridge.api.mqtt.publish).mockRejectedValueOnce(
      new Error('Publish refused: not authorized')
    )
    await expect(confirmed(() => actions.clearRetained('a/b/c'))).resolves.toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Could not clear the retained message', {
      description: 'Publish refused: not authorized'
    })
  })

  it('needs a connection', async () => {
    seedRetained(2)
    const actions = scope.run(() => useTopicActions(id))
    if (!actions) throw new Error('no scope')
    await expect(actions.clearRetainedBelow('a')).resolves.toBe(0)
    expect(setup.bridge.api.mqtt.publish).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Not connected', expect.anything())
  })
})
