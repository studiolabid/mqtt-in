import { afterEach, describe, expect, it } from 'vitest'
import { createConnectionProfile } from '@shared/defaults'
import type { ConnectionProfile, PublishRequest, QoS } from '@shared/models'
import { utf8Encode } from '@shared/payload'
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
  publish: (request: Partial<PublishRequest>) => Promise<string>
  connects: () => number
  last: () => string | undefined
}

/** A v5 session connected to a fake broker; `publish` resolves 'ok' or the error message. */
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
    clientId: 'limits',
    autoReconnect: true,
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
    last: () => recorder.status.at(-1)?.status,
    publish: (request) =>
      mqtt
        .publish(profile.id, {
          topic: 't',
          payload: utf8Encode('x'),
          qos: 0,
          retain: false,
          ...request
        })
        .then(
          () => 'ok',
          (err: Error) => err.message
        )
  }
}

const outgoing = (h: Harness, topic: string): number =>
  h.recorder.messages.filter((m) => m.direction === 'out' && m.topic === topic).length

describe('Maximum Packet Size (MQ-04)', () => {
  it('refuses an oversized publish locally at QoS 0 and 1: nothing sent, still connected', async () => {
    const h = await connect({ connack: { properties: { maximumPacketSize: 1024 } } })
    for (const qos of [0, 1] as QoS[]) {
      expect(await h.publish({ topic: 'big', payload: new Uint8Array(4000), qos })).toBe(
        'Message is 3.9 KB; the broker accepts at most 1 KB per packet'
      )
    }
    expect(await h.publish({ topic: 'small', payload: new Uint8Array(900), qos: 1 })).toBe('ok')
    await sleep(100)
    expect(h.fake.publishes.map((p) => p.topic)).toEqual(['small'])
    expect(h.fake.disconnectsSent).toEqual([])
    expect(h.last()).toBe('connected')
    expect(outgoing(h, 'big')).toBe(0) // CT-27: a locally refused publish never shows as sent
  })

  it('shows exact sizes when they would round to the same text', async () => {
    const h = await connect({ connack: { properties: { maximumPacketSize: 1024 * 1024 } } })
    expect(await h.publish({ topic: 'big', payload: new Uint8Array(1024 * 1024) })).toBe(
      'Message is 1,048,586 bytes; the broker accepts at most 1,048,576 bytes per packet'
    )
  })

  it('drops a QoS 1 publish the broker disconnects for, and stops after 3 such disconnects', async () => {
    // The broker did not announce its limit: only its DISCONNECT 0x95 tells.
    const h = await connect({ onPublish: (p) => (p.qos === 1 ? { disconnect: 0x95 } : undefined) })
    const reason = 'Disconnected by the broker: packet too large'
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await waitFor(() => h.connects() === attempt, 4000, `connect ${attempt}`)
      expect(await h.publish({ topic: `big/${attempt}`, qos: 1 })).toBe(reason)
    }
    await waitFor(() => h.last() === 'error')
    await sleep(400)
    expect(h.recorder.status.at(-1)).toMatchObject({ status: 'error', error: reason })
    // Never resent after a reconnect: three PUBLISHes, no DUP replay, no fourth connection.
    expect(h.fake.publishes.map((p) => [p.topic, p.dup])).toEqual([
      ['big/1', false],
      ['big/2', false],
      ['big/3', false]
    ])
    expect(h.fake.connects).toHaveLength(3)
    expect(h.fake.disconnectsSent.map((d) => d.code)).toEqual([0x95, 0x95, 0x95])
  })
})

describe('Receive Maximum (MQ-05)', () => {
  it('keeps a 20-message QoS 1 repeat job within the broker quota', async () => {
    const h = await connect({ connack: { properties: { receiveMaximum: 2 } }, ackDelayMs: 300 })
    const jobId = h.mqtt.startRepeat(h.profile.id, {
      topic: 'rm/x',
      payload: 'n={{counter}}',
      format: 'text',
      qos: 1,
      retain: false,
      intervalMs: 10,
      count: 20
    })
    const done = await waitFor(
      () => h.recorder.repeat.find((e) => e.jobId === jobId && e.state !== 'running'),
      12_000,
      'job end'
    )
    expect(done).toMatchObject({ state: 'completed', sent: 20 })
    expect(h.fake.maxInFlight).toBeLessThanOrEqual(2)
    expect(h.fake.publishes).toHaveLength(20)
    expect(h.fake.disconnectsSent).toEqual([])
    expect(h.last()).toBe('connected')
  }, 15_000)

  it('queues concurrent manual publishes beyond the quota (FIFO)', async () => {
    const h = await connect({ connack: { properties: { receiveMaximum: 2 } }, ackDelayMs: 50 })
    const topics = Array.from({ length: 6 }, (_, i) => `q/${i}`)
    const results = await Promise.all(topics.map((topic) => h.publish({ topic, qos: 1 })))
    expect(results).toEqual(topics.map(() => 'ok'))
    expect(h.fake.publishes.map((p) => p.topic)).toEqual(topics)
    expect(h.fake.maxInFlight).toBe(2)
    expect(h.fake.disconnectsSent).toEqual([])
  })

  it('fails publishes still queued when the connection drops; sent ones are resent', async () => {
    const h = await connect({
      connack: { properties: { receiveMaximum: 1 } },
      onPublish: (_packet, connection) => (connection.index === 0 ? { hold: true } : undefined)
    })
    const sent = h.publish({ topic: 'held', qos: 1 })
    const queued = h.publish({ topic: 'queued', qos: 1 })
    await waitFor(() => h.fake.publishes.length === 1)
    h.fake.dropAll()
    expect(await queued).toBe('Connection lost')
    expect(await sent).toBe('ok') // replayed after the reconnect and acknowledged
    // (mqtt.js resends without the DUP flag: MQTT-15, deferred.)
    expect(h.fake.publishes.map((p) => p.topic)).toEqual(['held', 'held'])
    expect(outgoing(h, 'queued')).toBe(0)
  })
})

describe('Topic Alias Maximum (MQ-06)', () => {
  it('refuses a topic alias when the broker announced none, at once', async () => {
    const h = await connect({})
    const started = Date.now()
    const result = await h.publish({ qos: 1, properties: { topicAlias: 1 } })
    expect(result).toBe('The broker does not support topic aliases')
    expect(Date.now() - started).toBeLessThan(500)
    expect(h.fake.publishes).toEqual([])
    expect(() =>
      h.mqtt.startRepeat(h.profile.id, {
        topic: 'alias/x',
        payload: 'x',
        format: 'text',
        qos: 1,
        retain: false,
        intervalMs: 10,
        count: 5,
        properties: { topicAlias: 1 }
      })
    ).toThrow('The broker does not support topic aliases')
    expect(h.recorder.repeat).toEqual([])
  })

  it('accepts aliases up to the announced maximum', async () => {
    const h = await connect({ connack: { properties: { topicAliasMaximum: 5 } } })
    expect(await h.publish({ qos: 1, properties: { topicAlias: 6 } })).toBe(
      'The broker accepts topic aliases 1–5'
    )
    expect(await h.publish({ topic: 'a/5', qos: 1, properties: { topicAlias: 5 } })).toBe('ok')
    expect(h.fake.publishes.map((p) => [p.topic, p.properties?.topicAlias])).toEqual([['a/5', 5]])
    expect(h.fake.disconnectsSent).toEqual([])
  })
})

describe('MQTT string limits (MQ-08)', () => {
  it('refuses a content type over 65,535 bytes and stays usable', async () => {
    const h = await connect({})
    for (const qos of [0, 1] as QoS[]) {
      const properties = { contentType: 'ü'.repeat(40_000) } // 80,000 UTF-8 bytes
      expect(await h.publish({ topic: 'str/x', qos, properties })).toBe(
        'Content type is too long (max 65535 bytes)'
      )
    }
    expect(await h.publish({ topic: 'str/after', qos: 1 })).toBe('ok')
    expect(h.fake.publishes.map((p) => p.topic)).toEqual(['str/after'])
    expect(h.fake.disconnectsSent).toEqual([])
    expect(h.last()).toBe('connected')
  })

  it('checks every string of the request', async () => {
    const h = await connect({})
    const long = 'v'.repeat(70_000)
    const lone = String.fromCharCode(0xdc00)
    expect(await h.publish({ topic: `a${lone}` })).toBe('Topic contains an unpaired surrogate')
    expect(await h.publish({ properties: { responseTopic: long } })).toBe(
      'Response topic is too long (max 65535 bytes)'
    )
    expect(await h.publish({ properties: { correlationData: long } })).toBe(
      'Correlation data is too long (max 65535 bytes)'
    )
    expect(await h.publish({ properties: { userProperties: [{ key: 'k', value: long }] } })).toBe(
      'User property value is too long (max 65535 bytes)'
    )
    expect(h.fake.publishes).toEqual([])
  })
})
