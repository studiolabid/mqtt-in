import { createServer, type Server } from 'node:net'
import { Aedes } from 'aedes'
import { connectAsync } from 'mqtt'
import { afterEach, describe, expect, it } from 'vitest'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import type { ConnectionProfile, MqttMessage, RepeatJobEvent } from '@shared/models'
import { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import { createRecorder, freePort, type Recorder, sleep, waitFor } from './helpers/broker'

/** An aedes broker (MQTT 3.1.1, in-memory persistent sessions) on a fixed port. */
interface PortBroker {
  broker: Aedes
  close(): Promise<void>
}

async function startBrokerOn(port: number): Promise<PortBroker> {
  const broker = await Aedes.createBroker()
  const server: Server = createServer(broker.handle)
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    broker,
    close: async () => {
      await new Promise<void>((resolve) => broker.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

let brokers: PortBroker[] = []
let manager: MqttManager | null = null

afterEach(async () => {
  await manager?.disposeAll(1000)
  for (const broker of brokers) await broker.close().catch(() => undefined)
  manager = null
  brokers = []
})

async function setup(overrides: Partial<ConnectionProfile>): Promise<{
  port: number
  aedes: PortBroker
  profile: ConnectionProfile
  recorder: Recorder
  mqtt: MqttManager
}> {
  const port = await freePort()
  const aedes = await startBrokerOn(port)
  brokers.push(aedes)
  const profile = createConnectionProfile({
    host: '127.0.0.1',
    port,
    protocolVersion: 4,
    clientId: 'mqtt-in-resume',
    autoReconnect: false,
    ...overrides
  })
  const recorder = createRecorder()
  const mqtt = new MqttManager({
    profiles: { get: (id) => (id === profile.id ? profile : undefined) },
    sink: recorder.sink,
    batcher: { intervalMs: 5 }
  })
  manager = mqtt
  return { port, aedes, profile, recorder, mqtt }
}

/** CONNACKs so far (round-trip updates re-send `connected` with the same connectedAt). */
const connections = (recorder: Recorder): number =>
  new Set(recorder.status.filter((s) => s.status === 'connected').map((s) => s.connectedAt)).size

const incoming = (recorder: Recorder, topic: string): MqttMessage | undefined =>
  recorder.messages.find((m) => m.direction === 'in' && m.topic === topic)

/** Publishes each topic once (QoS 1) from a second client. */
async function publishFromPeer(port: number, topics: string[]): Promise<void> {
  const peer = await connectAsync(`mqtt://127.0.0.1:${port}`, { clientId: 'peer' })
  for (const topic of topics) await peer.publishAsync(topic, 'x', { qos: 1 })
  await peer.endAsync()
}

describe('resumed persistent sessions drop stale subscriptions (MQ-12)', () => {
  it('unsubscribes a subscription disabled while disconnected', async () => {
    const stale = createSubscription({ topic: 'stale/#', qos: 1 })
    const keep = createSubscription({ topic: 'keep/#', qos: 1 })
    const h = await setup({ clean: false, subscriptions: [stale, keep] })
    await h.mqtt.connect(h.profile.id)
    await waitFor(
      () => h.recorder.subscriptions.filter((e) => e.state === 'subscribed').length === 2
    )
    await h.mqtt.disconnect(h.profile.id)

    h.profile.subscriptions = [{ ...stale, enabled: false }, keep]
    const unsubscribed: string[] = []
    h.aedes.broker.on('unsubscribe', (filters) => unsubscribed.push(...filters))
    await h.mqtt.connect(h.profile.id)
    await waitFor(() => connections(h.recorder) === 2, 4000, 'second connect')
    expect(h.recorder.status.filter((s) => s.status === 'connected')[1].sessionPresent).toBe(true)
    await waitFor(() =>
      h.recorder.logs.some(
        (l) => l.message === 'Removed the stale subscription to stale/# (resumed session)'
      )
    )
    expect(unsubscribed).toEqual(['stale/#'])

    await publishFromPeer(h.port, ['stale/x', 'keep/x'])
    await waitFor(() => incoming(h.recorder, 'keep/x'), 4000, 'keep/x')
    await sleep(100)
    expect(incoming(h.recorder, 'stale/x')).toBeUndefined()
  })

  it('unsubscribes a filter an earlier session subscribed that the profile no longer has', async () => {
    const gone = createSubscription({ topic: 'gone/#' })
    const keep = createSubscription({ topic: 'kept/#' })
    const h = await setup({ clean: false, subscriptions: [gone, keep] })
    await h.mqtt.connect(h.profile.id)
    await waitFor(
      () => h.recorder.subscriptions.filter((e) => e.state === 'subscribed').length === 2
    )
    await h.mqtt.disconnect(h.profile.id)

    h.profile.subscriptions = [keep] // removed while disconnected
    await h.mqtt.connect(h.profile.id)
    await waitFor(() =>
      h.recorder.logs.some(
        (l) => l.message === 'Removed the stale subscription to gone/# (resumed session)'
      )
    )
    await publishFromPeer(h.port, ['gone/x', 'kept/x'])
    await waitFor(() => incoming(h.recorder, 'kept/x'), 4000, 'kept/x')
    await sleep(100)
    expect(incoming(h.recorder, 'gone/x')).toBeUndefined()
  })

  it('sends no UNSUBSCRIBE when the broker kept no session (clean start)', async () => {
    const sub = createSubscription({ topic: 'clean/#' })
    const h = await setup({ clean: true, subscriptions: [sub] })
    await h.mqtt.connect(h.profile.id)
    await waitFor(() => h.recorder.subscriptions.find((e) => e.state === 'subscribed'))
    await h.mqtt.disconnect(h.profile.id)
    h.profile.subscriptions = [{ ...sub, enabled: false }]
    const unsubscribed: string[] = []
    h.aedes.broker.on('unsubscribe', (filters) => unsubscribed.push(...filters))
    await h.mqtt.connect(h.profile.id)
    await waitFor(() => connections(h.recorder) === 2)
    await sleep(100)
    expect(unsubscribed).toEqual([])
    expect(h.recorder.logs.some((l) => l.message.includes('stale subscription'))).toBe(false)
  })
})

describe('repeat jobs across reconnects (MQ-14)', () => {
  it('keeps a job running while the broker restarts, then stops it on disconnect', async () => {
    const h = await setup({ autoReconnect: true, reconnectPeriod: 100 })
    await h.mqtt.connect(h.profile.id)
    await waitFor(() => connections(h.recorder) === 1)
    const jobId = h.mqtt.startRepeat(h.profile.id, {
      topic: 'job/x',
      payload: 'n={{counter}}',
      format: 'text',
      qos: 1,
      retain: false,
      intervalMs: 50,
      count: 0
    })
    const events = (): RepeatJobEvent[] => h.recorder.repeat.filter((e) => e.jobId === jobId)
    const sent = (): number => events().at(-1)?.sent ?? 0
    await waitFor(() => sent() >= 3, 4000, '3 messages')

    await h.aedes.close() // the broker goes away…
    await waitFor(() => h.recorder.status.find((s) => s.status === 'reconnecting'))
    await sleep(300) // …for a few failed attempts
    brokers.push(await startBrokerOn(h.port))
    await waitFor(() => connections(h.recorder) === 2, 8000, 'reconnected')
    const before = sent()
    await waitFor(() => sent() >= before + 3, 4000, 'more messages after the reconnect')

    expect(events().every((e) => e.state === 'running')).toBe(true)
    expect(h.mqtt.getSessions()[0].repeatJobs).toEqual([
      expect.objectContaining({ jobId, state: 'running' })
    ])
    await h.mqtt.disconnect(h.profile.id)
    expect(events().at(-1)).toMatchObject({ state: 'stopped' })
    expect(events().some((e) => e.state === 'error')).toBe(false)
  })
})
