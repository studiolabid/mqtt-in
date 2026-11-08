import type { Packet } from 'mqtt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import type { ConnectionProfile, StatusEvent } from '@shared/models'
import { utf8Encode } from '@shared/payload'
import { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import { MqttSession } from '../../../src/main/services/mqtt/mqtt-session'
import { createRecorder, type Recorder, waitFor } from './helpers/broker'
import { fakeConnector, type FakeMqttClient } from './helpers/fake-client'
import { type FakeBroker5, type FakeBroker5Options, startFakeBroker5 } from './helpers/fake-broker5'

let broker: FakeBroker5 | null = null
let manager: MqttManager | null = null

afterEach(async () => {
  vi.useRealTimers()
  await manager?.disposeAll(1000)
  await broker?.close()
  manager = null
  broker = null
})

/** A session connected to a fake broker; resolves once the first CONNACK arrived. */
async function connectTo(
  options: FakeBroker5Options,
  overrides: Partial<ConnectionProfile> = {}
): Promise<{ profile: ConnectionProfile; recorder: Recorder; mqtt: MqttManager }> {
  broker = await startFakeBroker5(options)
  const profile = createConnectionProfile({
    host: '127.0.0.1',
    port: broker.port,
    protocolVersion: 5,
    clientId: 'status',
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
  await mqtt.connect(profile.id)
  await waitFor(() => recorder.status.find((s) => s.status === 'connected'), 4000, 'connected')
  return { profile, recorder, mqtt }
}

const connectedEvent = (recorder: Recorder): StatusEvent | undefined =>
  recorder.status.find((s) => s.status === 'connected')

describe('broker info (MQ-17)', () => {
  it('carries the CONNACK properties on the connected event and in the snapshot', async () => {
    const { profile, recorder, mqtt } = await connectTo({
      connack: { properties: { receiveMaximum: 10, topicAliasMaximum: 5 } }
    })
    const expected = {
      protocolVersion: 5,
      sessionPresent: false,
      receiveMaximum: 10,
      topicAliasMaximum: 5
    }
    expect(connectedEvent(recorder)?.broker).toEqual(expected)
    expect(mqtt.getSessions()[0].broker).toEqual(expected)
    await mqtt.disconnect(profile.id)
    expect(mqtt.getSessions()[0].broker).toBeUndefined()
    expect(recorder.status.at(-1)?.broker).toBeUndefined()
  })

  it('copies every announced capability, and only those', async () => {
    const { recorder } = await connectTo(
      {
        connack: {
          sessionPresent: false,
          properties: {
            maximumQoS: 1,
            retainAvailable: false,
            wildcardSubscriptionAvailable: true,
            sharedSubscriptionAvailable: false,
            subscriptionIdentifiersAvailable: true,
            maximumPacketSize: 1_048_576,
            serverKeepAlive: 30,
            assignedClientIdentifier: 'auto-1',
            responseInformation: 'resp/',
            reasonString: 'welcome'
          }
        }
      },
      { clientId: '' }
    )
    expect(connectedEvent(recorder)).toMatchObject({ clientId: 'auto-1' })
    expect(connectedEvent(recorder)?.broker).toEqual({
      protocolVersion: 5,
      sessionPresent: false,
      assignedClientId: 'auto-1',
      maximumQoS: 1,
      retainAvailable: false,
      wildcardSubscriptionAvailable: true,
      sharedSubscriptionAvailable: false,
      subscriptionIdentifiersAvailable: true,
      maximumPacketSize: 1_048_576,
      serverKeepAlive: 30,
      responseInformation: 'resp/'
    })
  })

  it('has only the protocol version and session present on MQTT 3.1.1', async () => {
    const { recorder, mqtt } = await connectTo({}, { protocolVersion: 4 })
    expect(connectedEvent(recorder)?.broker).toEqual({ protocolVersion: 4, sessionPresent: false })
    expect(mqtt.getSessions()[0].broker).toEqual({ protocolVersion: 4, sessionPresent: false })
  })
})

describe('round-trip time (MQ-17)', () => {
  interface Harness {
    session: MqttSession
    client: FakeMqttClient
    recorder: Recorder
  }

  function start(): Harness {
    const profile = createConnectionProfile({ protocolVersion: 5, reconnectPeriod: 1000 })
    const recorder = createRecorder()
    const connector = fakeConnector()
    const session = new MqttSession({
      profile,
      sink: recorder.sink,
      pushMessage: () => {},
      connect: connector.connect
    })
    void session.connect()
    return { session, client: connector.clients[0], recorder }
  }

  /** Sends `request`, answers it after `ms` (fake time). */
  function roundTrip(h: Harness, request: Packet, answer: Packet, ms: number): void {
    h.client.emit('packetsend', request)
    vi.advanceTimersByTime(ms)
    h.client.emit('packetreceive', answer)
  }

  const ping = (h: Harness, ms: number): void =>
    roundTrip(h, { cmd: 'pingreq' }, { cmd: 'pingresp' }, ms)

  const rtts = (h: Harness): Array<number | undefined> =>
    h.recorder.status.filter((s) => s.rttMs !== undefined).map((s) => s.rttMs)

  it('announces the round trip at most every 5 s, and only when it changed by 10 %', () => {
    vi.useFakeTimers()
    const h = start()
    h.client.connack()
    ping(h, 250)
    expect(h.recorder.status.at(-1)).toMatchObject({ status: 'connected', rttMs: 250 })
    expect(h.session.snapshot().rttMs).toBe(250)

    vi.advanceTimersByTime(6000)
    ping(h, 260) // 4 % slower: no event, the snapshot has it
    expect(rtts(h)).toEqual([250])
    expect(h.session.snapshot().rttMs).toBe(260)

    vi.advanceTimersByTime(100)
    const publish: Packet = {
      cmd: 'publish',
      topic: 't',
      payload: Buffer.from('x'),
      qos: 1,
      messageId: 7,
      retain: false,
      dup: false
    }
    roundTrip(h, publish, { cmd: 'puback', messageId: 7 }, 500) // QoS 1 PUBLISH → PUBACK
    expect(rtts(h)).toEqual([250, 500])

    vi.advanceTimersByTime(1000)
    ping(h, 300) // a change, but too soon after the last event: announced 5 s after it
    expect(rtts(h)).toEqual([250, 500])
    vi.advanceTimersByTime(3699)
    expect(rtts(h)).toEqual([250, 500])
    vi.advanceTimersByTime(1)
    expect(rtts(h)).toEqual([250, 500, 300])
    // Every round-trip event is a `connected` event with the CONNACK facts.
    expect(h.recorder.status.filter((s) => s.rttMs !== undefined).map((s) => s.status)).toEqual([
      'connected',
      'connected',
      'connected'
    ])
    expect(h.recorder.status.at(-1)?.broker).toMatchObject({ protocolVersion: 5 })

    h.client.drop()
    expect(h.session.snapshot().rttMs).toBeUndefined()
    expect(h.recorder.status.at(-1)).toMatchObject({ status: 'reconnecting' })
    expect(h.recorder.status.at(-1)?.rttMs).toBeUndefined()
  })

  it('ignores answers without a matching request', () => {
    vi.useFakeTimers()
    const h = start()
    h.client.connack()
    h.client.emit('packetreceive', { cmd: 'pingresp' })
    h.client.emit('packetreceive', { cmd: 'puback', messageId: 3 })
    expect(rtts(h)).toEqual([])
  })
})

describe('outgoing messages in stream order (MQ-15)', () => {
  it('lists a QoS 1 publish before the echo the broker sends ahead of its PUBACK', async () => {
    const sub = createSubscription({ topic: 'echo/#', qos: 1 })
    const { profile, recorder, mqtt } = await connectTo(
      { ackDelayMs: 50 },
      { subscriptions: [sub] }
    )
    await waitFor(() => recorder.subscriptions.find((e) => e.state === 'subscribed'))
    for (const qos of [1, 0] as const) {
      const topic = `echo/${qos}`
      await mqtt.publish(profile.id, { topic, payload: utf8Encode('x'), qos, retain: false })
      await waitFor(() => recorder.messages.find((m) => m.direction === 'in' && m.topic === topic))
      const out = recorder.messages.find((m) => m.direction === 'out' && m.topic === topic)
      const echo = recorder.messages.find((m) => m.direction === 'in' && m.topic === topic)
      if (!out || !echo) throw new Error('missing message')
      expect(out.id).toBeLessThan(echo.id)
      expect(out.timestamp).toBeLessThanOrEqual(echo.timestamp)
      expect(recorder.messages.indexOf(out)).toBeLessThan(recorder.messages.indexOf(echo))
    }
  })

  it('keeps the row of a publish the broker refuses afterwards (CT-27)', async () => {
    const { profile, recorder, mqtt } = await connectTo({
      onPublish: () => ({ reasonCode: 0x87 })
    })
    const result = await mqtt
      .publish(profile.id, { topic: 'deny', payload: utf8Encode('x'), qos: 1, retain: false })
      .then(
        () => 'ok',
        (err: Error) => err.message
      )
    expect(result).toBe('Publish refused: not authorized')
    await waitFor(() => recorder.messages.find((m) => m.direction === 'out' && m.topic === 'deny'))
  })
})
