import { connectAsync, type MqttClient } from 'mqtt'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import type { ConnectionProfile, MqttMessage } from '@shared/models'
import { utf8Decode, utf8Encode } from '@shared/payload'
import { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import {
  createRecorder,
  type Recorder,
  sleep,
  startBroker,
  type TestBroker,
  waitFor
} from './helpers/broker'

let server: TestBroker
let peer: MqttClient
let manager: MqttManager | null = null

beforeAll(async () => {
  server = await startBroker()
  peer = await connectAsync(`mqtt://127.0.0.1:${server.port}`, { clientId: 'peer' })
})

afterEach(async () => {
  await manager?.disposeAll(1000)
  manager = null
})

afterAll(async () => {
  await peer.endAsync()
  await server.close()
})

function setup(overrides: Partial<ConnectionProfile> = {}): {
  profile: ConnectionProfile
  recorder: Recorder
  manager: MqttManager
} {
  const profile = createConnectionProfile({
    host: '127.0.0.1',
    port: server.port,
    protocolVersion: 4,
    clientId: '',
    autoReconnect: false,
    ...overrides
  })
  const recorder = createRecorder()
  manager = new MqttManager({
    profiles: { get: (id) => (id === profile.id ? profile : undefined) },
    sink: recorder.sink,
    batcher: { intervalMs: 5 }
  })
  return { profile, recorder, manager }
}

const incoming = (recorder: Recorder, topic: string): MqttMessage | undefined =>
  recorder.messages.find((m) => m.direction === 'in' && m.topic === topic)

describe('MqttManager + MqttSession against aedes', () => {
  it('connects and auto-subscribes the enabled subscriptions only', async () => {
    const enabled = createSubscription({ topic: 'auto/#', qos: 1 })
    const disabled = createSubscription({ topic: 'off/#', enabled: false })
    const { profile, recorder, manager } = setup({ subscriptions: [enabled, disabled] })

    await manager.connect(profile.id)
    const connected = await waitFor(
      () => recorder.status.find((s) => s.status === 'connected'),
      4000,
      'connected'
    )
    expect(recorder.status[0]).toMatchObject({ connectionId: profile.id, status: 'connecting' })
    expect(connected.clientId).toMatch(/^mqttin_[0-9a-f]{8}$/)
    expect(connected.sessionPresent).toBe(false)
    expect(connected.connectedAt).toBeGreaterThan(0)

    const subscribed = await waitFor(() =>
      recorder.subscriptions.find(
        (e) => e.subscriptionId === enabled.id && e.state === 'subscribed'
      )
    )
    expect(subscribed.grantedQos).toBe(1)
    expect(recorder.subscriptions.find((e) => e.subscriptionId === enabled.id)?.state).toBe(
      'pending'
    )
    expect(recorder.subscriptions.some((e) => e.subscriptionId === disabled.id)).toBe(false)

    const [snapshot] = manager.getSessions()
    expect(snapshot).toMatchObject({ connectionId: profile.id, status: 'connected' })
    expect(snapshot.subscriptions).toEqual([expect.objectContaining({ state: 'subscribed' })])
    expect(
      recorder.logs.some((l) => l.level === 'info' && l.message.startsWith('Connecting to'))
    ).toBe(true)
    expect(recorder.logs.some((l) => l.level === 'debug' && l.message === '← CONNACK')).toBe(true)
  })

  it('receives messages with copied payloads', async () => {
    const sub = createSubscription({ topic: 'recv/#', qos: 0 })
    const { profile, recorder, manager } = setup({ subscriptions: [sub] })
    await manager.connect(profile.id)
    await waitFor(() => recorder.subscriptions.find((e) => e.state === 'subscribed'))

    await peer.publishAsync('recv/a', 'hello', { qos: 1 })
    const message = await waitFor(() => incoming(recorder, 'recv/a'), 4000, 'incoming message')

    expect(utf8Decode(message.payload)).toBe('hello')
    expect(Object.getPrototypeOf(message.payload)).toBe(Uint8Array.prototype)
    expect(message.payload.byteOffset).toBe(0)
    expect(message.payload.buffer.byteLength).toBe(message.payload.byteLength)
    expect(message).toMatchObject({ connectionId: profile.id, qos: 0, retain: false, dup: false })
    expect(message.properties).toBeUndefined()
  })

  it('reports successful publishes as outgoing messages (echo included)', async () => {
    const sub = createSubscription({ topic: 'echo/#', qos: 1 })
    const { profile, recorder, manager } = setup({ subscriptions: [sub] })
    await manager.connect(profile.id)
    await waitFor(() => recorder.subscriptions.find((e) => e.state === 'subscribed'))

    await manager.publish(profile.id, {
      topic: 'echo/1',
      payload: utf8Encode('ping'),
      qos: 1,
      retain: false
    })
    const out = await waitFor(() =>
      recorder.messages.find((m) => m.direction === 'out' && m.topic === 'echo/1')
    )
    expect(utf8Decode(out.payload)).toBe('ping')
    expect(out.qos).toBe(1)
    const echo = await waitFor(() => incoming(recorder, 'echo/1'))
    expect(echo.id).not.toBe(out.id)
  })

  it('delivers retained messages with the retain flag', async () => {
    await peer.publishAsync('retained/state', 'on', { qos: 1, retain: true })
    const { profile, recorder, manager } = setup()
    await manager.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'connected'))

    const event = await manager.subscribe(
      profile.id,
      createSubscription({ topic: 'retained/#', qos: 1 })
    )
    expect(event).toMatchObject({ state: 'subscribed', grantedQos: 1 })
    const message = await waitFor(() => incoming(recorder, 'retained/state'))
    expect(message.retain).toBe(true)
    expect(utf8Decode(message.payload)).toBe('on')
    await peer.publishAsync('retained/state', '', { qos: 1, retain: true })
  })

  it('unsubscribes', async () => {
    const sub = createSubscription({ topic: 'unsub/#' })
    const { profile, recorder, manager } = setup({ subscriptions: [sub] })
    await manager.connect(profile.id)
    await waitFor(() => recorder.subscriptions.find((e) => e.state === 'subscribed'))

    const event = await manager.unsubscribe(profile.id, sub)
    expect(event).toMatchObject({ subscriptionId: sub.id, state: 'idle' })
    await peer.publishAsync('unsub/x', 'ignored', { qos: 1 })
    await sleep(150)
    expect(incoming(recorder, 'unsub/x')).toBeUndefined()
  })

  it('resolves overlapping requests for one subscription with the final state', async () => {
    const sub = createSubscription({ topic: 'overlap/#' })
    const { profile, recorder, manager } = setup({ subscriptions: [sub] })
    await manager.connect(profile.id)
    await waitFor(() => recorder.subscriptions.find((e) => e.state === 'subscribed'))

    // Two unsubscribes in flight (e.g. the UI and its orphan cleanup): both report `idle`.
    const [first, second] = await Promise.all([
      manager.unsubscribe(profile.id, sub),
      manager.unsubscribe(profile.id, sub)
    ])
    expect([first.state, second.state]).toEqual(['idle', 'idle'])

    // A subscribe overtaken by an unsubscribe reports where the subscription ended up.
    const [subscribed, unsubscribed] = await Promise.all([
      manager.subscribe(profile.id, sub),
      manager.unsubscribe(profile.id, sub)
    ])
    expect([subscribed.state, unsubscribed.state]).toEqual(['idle', 'idle'])
    expect(manager.getSessions()[0].subscriptions[0]).toMatchObject({ state: 'idle' })
  })

  it('keeps a broker subscription that another subscription still uses', async () => {
    const first = createSubscription({ topic: 'dup/#' })
    const second = createSubscription({ topic: 'dup/#' })
    const { profile, recorder, manager } = setup({ subscriptions: [first, second] })
    await manager.connect(profile.id)
    await waitFor(() => recorder.subscriptions.filter((e) => e.state === 'subscribed').length === 2)

    expect(await manager.unsubscribe(profile.id, first)).toMatchObject({ state: 'idle' })
    await peer.publishAsync('dup/x', 'still here', { qos: 1 })
    expect(utf8Decode((await waitFor(() => incoming(recorder, 'dup/x'))).payload)).toBe(
      'still here'
    )
  })

  it('disconnects gracefully', async () => {
    const sub = createSubscription({ topic: 'bye/#' })
    const { profile, recorder, manager } = setup({ subscriptions: [sub] })
    await manager.connect(profile.id)
    await waitFor(() => recorder.subscriptions.find((e) => e.state === 'subscribed'))
    const gone = new Promise<string>((resolve) =>
      server.broker.once('clientDisconnect', (client) => resolve(client.id))
    )

    await manager.disconnect(profile.id)

    const statuses = recorder.status.map((s) => s.status)
    expect(statuses.slice(-2)).toEqual(['disconnecting', 'disconnected'])
    expect(recorder.subscriptions.at(-1)).toMatchObject({ subscriptionId: sub.id, state: 'idle' })
    expect(await gone).toMatch(/^mqttin_/)
    expect(manager.getSessions()[0]).toMatchObject({ status: 'disconnected' })
    await expect(
      manager.publish(profile.id, { topic: 'x', payload: new Uint8Array(), qos: 0, retain: false })
    ).rejects.toThrow('Not connected')
  })

  it('runs repeat jobs with the template counter', async () => {
    const { profile, recorder, manager } = setup()
    await manager.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'connected'))

    const jobId = manager.startRepeat(profile.id, {
      topic: 'repeat/x',
      payload: '{"n": {{counter}}}',
      format: 'json',
      qos: 0,
      retain: false,
      intervalMs: 20,
      count: 3
    })
    const done = await waitFor(() =>
      recorder.repeat.find((e) => e.jobId === jobId && e.state === 'completed')
    )
    expect(done).toMatchObject({ connectionId: profile.id, sent: 3, total: 3 })
    await waitFor(() => recorder.messages.filter((m) => m.topic === 'repeat/x').length === 3)
    const sent = recorder.messages
      .filter((m) => m.direction === 'out' && m.topic === 'repeat/x')
      .map((m) => utf8Decode(m.payload))
    expect(sent).toEqual(['{"n": 1}', '{"n": 2}', '{"n": 3}'])
    expect(manager.getSessions()[0].repeatJobs).toEqual([])
  })

  it('stops repeat jobs on disconnect', async () => {
    const { profile, recorder, manager } = setup()
    await manager.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'connected'))
    const jobId = manager.startRepeat(profile.id, {
      topic: 'repeat/y',
      payload: 'tick',
      format: 'text',
      qos: 0,
      retain: false,
      intervalMs: 50,
      count: 0
    })
    expect(manager.getSessions()[0].repeatJobs).toEqual([
      expect.objectContaining({ jobId, state: 'running' })
    ])
    await manager.disconnect(profile.id)
    expect(recorder.repeat.at(-1)).toMatchObject({ jobId, state: 'stopped' })
  })

  it('rejects operations without a connected session', async () => {
    const { profile, manager } = setup()
    const sub = createSubscription({ topic: 'a' })
    await expect(manager.subscribe(profile.id, sub)).rejects.toThrow('Not connected')
    expect(() =>
      manager.startRepeat(profile.id, {
        topic: 'a',
        payload: 'x',
        format: 'text',
        qos: 0,
        retain: false,
        intervalMs: 100,
        count: 1
      })
    ).toThrow('Not connected')
    await expect(manager.connect('unknown')).rejects.toThrow('Connection not found')
  })
})
