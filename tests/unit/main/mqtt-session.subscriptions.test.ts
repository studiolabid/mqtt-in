import { afterEach, describe, expect, it } from 'vitest'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import type { ConnectionProfile, SubscriptionEvent } from '@shared/models'
import { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import { createRecorder, type Recorder, sleep, waitFor } from './helpers/broker'
import { type FakeBroker5, type FakeBroker5Options, startFakeBroker5 } from './helpers/fake-broker5'

let broker: FakeBroker5 | null = null
let manager: MqttManager | null = null

afterEach(async () => {
  await manager?.disposeAll(1000)
  await broker?.close()
  manager = null
  broker = null
})

interface Harness {
  fake: FakeBroker5
  mqtt: MqttManager
  profile: ConnectionProfile
  recorder: Recorder
  connects: () => number
  state: (subId: string) => SubscriptionEvent | undefined
  subscribed: () => string[]
}

/** A v5 session connected to a fake broker (auto-reconnect every 100 ms). */
async function connect(
  options: FakeBroker5Options,
  overrides: Partial<ConnectionProfile> = {}
): Promise<Harness> {
  const fake = await startFakeBroker5(options)
  broker = fake
  const profile = createConnectionProfile({
    host: '127.0.0.1',
    port: fake.port,
    protocolVersion: 5,
    clientId: 'subs',
    reconnectPeriod: 100,
    ...overrides
  })
  const recorder = createRecorder()
  const mqtt = new MqttManager({
    profiles: { get: (id) => (id === profile.id ? profile : undefined) },
    sink: recorder.sink,
    batcher: { intervalMs: 5 }
  })
  manager = mqtt
  // Round-trip updates re-send `connected` with the same connectedAt: count the CONNACKs.
  const connects = (): number =>
    new Set(recorder.status.filter((s) => s.status === 'connected').map((s) => s.connectedAt)).size
  await mqtt.connect(profile.id)
  await waitFor(() => connects() === 1, 4000, 'connected')
  return {
    fake,
    mqtt,
    profile,
    recorder,
    connects,
    state: (subId) => recorder.subscriptions.filter((e) => e.subscriptionId === subId).at(-1),
    subscribed: () => fake.subscribes.flatMap((p) => p.subscriptions.map((s) => s.topic))
  }
}

const statesOf = (h: Harness, subId: string): string[] =>
  h.recorder.subscriptions.filter((e) => e.subscriptionId === subId).map((e) => e.state)

/** A persistent session: the second and later CONNACKs resume it. */
const resumes = (_connect: unknown, index: number): { sessionPresent: boolean } => ({
  sessionPresent: index > 0
})

describe('resumed sessions (MQ-11)', () => {
  it('re-subscribes a refused subscription and never reports it subscribed', async () => {
    const ok = createSubscription({ topic: 'ok/#', qos: 1 })
    const sys = createSubscription({ topic: '$SYS/#' })
    const h = await connect(
      {
        connack: resumes,
        onSubscribe: (packet) =>
          packet.subscriptions[0].topic === '$SYS/#' ? { reasonCodes: [0x87] } : undefined
      },
      { clean: false, subscriptions: [ok, sys] }
    )
    await waitFor(
      () => h.state(sys.id)?.state === 'failed' && h.state(ok.id)?.state === 'subscribed'
    )
    h.fake.dropAll() // a network blip: the broker keeps the session
    await waitFor(() => h.connects() === 2, 4000, 'reconnected')
    await waitFor(() => h.subscribed().length === 3 && h.state(sys.id)?.state === 'failed')
    // ok/# kept its grant (no new SUBSCRIBE); $SYS/# was asked again and refused again.
    expect(h.subscribed()).toEqual(['ok/#', '$SYS/#', '$SYS/#'])
    expect(statesOf(h, sys.id)).not.toContain('subscribed')
    expect(h.state(sys.id)?.error).toBe('Not authorized (0x87)')
    expect(h.state(ok.id)).toMatchObject({ state: 'subscribed', grantedQos: 1 })
    expect(h.mqtt.getSessions()[0].subscriptions).toEqual([
      expect.objectContaining({ subscriptionId: ok.id, state: 'subscribed' }),
      expect.objectContaining({ subscriptionId: sys.id, state: 'failed' })
    ])
  })

  it('re-sends a SUBSCRIBE the connection lost before its SUBACK', async () => {
    const late = createSubscription({ topic: 'late/#' })
    let answered = 0
    const h = await connect(
      {
        connack: resumes,
        // The first SUBSCRIBE never gets a SUBACK: the broker drops the connection instead.
        onSubscribe: () => (answered++ === 0 ? { disconnect: 0x80 } : undefined)
      },
      { clean: false, subscriptions: [late] }
    )
    await waitFor(() => h.connects() === 2, 4000, 'reconnected')
    await waitFor(() => h.state(late.id)?.state === 'subscribed')
    expect(h.subscribed()).toEqual(['late/#', 'late/#'])
    expect(statesOf(h, late.id).filter((s) => s === 'subscribed')).toHaveLength(1)
  })

  it('reports granted subscriptions of a resumed session without asking again', async () => {
    const sub = createSubscription({ topic: 'kept/#', qos: 2 })
    const h = await connect({ connack: resumes }, { clean: false, subscriptions: [sub] })
    await waitFor(() => h.state(sub.id)?.state === 'subscribed')
    h.fake.dropAll()
    await waitFor(() => h.connects() === 2, 4000, 'reconnected')
    await waitFor(() => statesOf(h, sub.id).filter((s) => s === 'subscribed').length === 2)
    expect(h.subscribed()).toEqual(['kept/#'])
    expect(h.state(sub.id)).toMatchObject({ state: 'subscribed', grantedQos: 2 })
  })
})

describe('CONNACK capability flags (MQ-13)', () => {
  it('fails wildcard subscriptions locally when the broker has no wildcard support', async () => {
    const wild = createSubscription({ topic: 'a/#' })
    const plain = createSubscription({ topic: 'a/b' })
    const h = await connect(
      { connack: { properties: { wildcardSubscriptionAvailable: false } } },
      { subscriptions: [wild, plain] }
    )
    await waitFor(
      () => h.state(wild.id)?.state === 'failed' && h.state(plain.id)?.state === 'subscribed'
    )
    const message = 'The broker does not support wildcard subscriptions'
    expect(h.state(wild.id)?.error).toBe(message)
    const logged = 'Cannot subscribe to a/#: the broker does not support wildcard subscriptions'
    expect(h.recorder.logs.some((l) => l.level === 'error' && l.message === logged)).toBe(true)
    // A subscription added while connected fails the same way, without a packet.
    const added = await h.mqtt.subscribe(h.profile.id, createSubscription({ topic: '+/x' }))
    expect(added).toMatchObject({ state: 'failed', error: message })
    await sleep(150)
    expect(h.subscribed()).toEqual(['a/b'])
    expect(h.fake.disconnectsSent).toEqual([])
    expect(h.connects()).toBe(1)
    expect(h.recorder.status.at(-1)?.status).toBe('connected')
  })

  it('fails shared subscriptions locally when the broker has no shared subscriptions', async () => {
    const shared = createSubscription({ topic: '$share/group/t' })
    const h = await connect(
      { connack: { properties: { sharedSubscriptionAvailable: false } } },
      { subscriptions: [shared] }
    )
    await waitFor(() => h.state(shared.id)?.state === 'failed')
    expect(h.state(shared.id)?.error).toBe('The broker does not support shared subscriptions')
    await sleep(100)
    expect(h.fake.subscribes).toEqual([])
    expect(h.fake.disconnectsSent).toEqual([])
  })

  it('subscribes without the identifier when the broker does not support them', async () => {
    const sub = createSubscription({ topic: 'id/x', subscriptionIdentifier: 7 })
    const h = await connect(
      { connack: { properties: { subscriptionIdentifiersAvailable: false } } },
      { subscriptions: [sub] }
    )
    await waitFor(() => h.state(sub.id)?.state === 'subscribed')
    expect(h.fake.subscribes).toHaveLength(1)
    expect(h.fake.subscribes[0].properties?.subscriptionIdentifier).toBeUndefined()
    expect(h.fake.disconnectsSent).toEqual([])
    expect(
      h.recorder.logs.some(
        (l) =>
          l.level === 'warn' &&
          l.message ===
            'Subscribed to id/x without its subscription identifier: the broker does not support them'
      )
    ).toBe(true)
  })

  it('keeps the identifier when the broker announced nothing (supported by default)', async () => {
    const sub = createSubscription({ topic: 'id/y', subscriptionIdentifier: 9 })
    const h = await connect({}, { subscriptions: [sub] })
    await waitFor(() => h.state(sub.id)?.state === 'subscribed')
    expect(h.fake.subscribes[0].properties?.subscriptionIdentifier).toBe(9)
  })
})
