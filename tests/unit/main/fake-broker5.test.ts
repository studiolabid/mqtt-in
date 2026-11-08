import { connect, type IClientOptions, type IDisconnectPacket, type MqttClient } from 'mqtt'
import { afterEach, describe, expect, it } from 'vitest'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import { utf8Decode, utf8Encode } from '@shared/payload'
import { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import { createRecorder, sleep, waitFor } from './helpers/broker'
import { type FakeBroker5, type FakeBroker5Options, startFakeBroker5 } from './helpers/fake-broker5'

let broker: FakeBroker5 | null = null
let manager: MqttManager | null = null
const clients: MqttClient[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) client.end(true)
  await manager?.disposeAll(1000)
  await broker?.close()
  manager = null
  broker = null
})

async function start(options: FakeBroker5Options = {}): Promise<FakeBroker5> {
  broker = await startFakeBroker5(options)
  return broker
}

/** A plain mqtt.js client (no app code, no flow control) and the DISCONNECTs it received. */
function rawClient(
  port: number,
  options: IClientOptions = {}
): { client: MqttClient; disconnects: IDisconnectPacket[] } {
  const client = connect(`mqtt://127.0.0.1:${port}`, {
    protocolVersion: 5,
    reconnectPeriod: 0,
    connectTimeout: 2000,
    ...options
  })
  clients.push(client)
  const disconnects: IDisconnectPacket[] = []
  client.on('disconnect', (packet) => disconnects.push(packet))
  client.on('error', () => {})
  return { client, disconnects }
}

const connected = (client: MqttClient): Promise<void> =>
  new Promise((resolve) => client.once('connect', () => resolve()))

describe('FakeBroker5 with MqttManager', () => {
  it('connects a v5 profile, subscribes, publishes at QoS 1 and receives the echo', async () => {
    const fake = await start({ connack: { properties: { receiveMaximum: 10 } } })
    const sub = createSubscription({ topic: 'echo/#', qos: 1 })
    const profile = createConnectionProfile({
      host: '127.0.0.1',
      port: fake.port,
      protocolVersion: 5,
      clientId: 'fake5-client',
      autoReconnect: false,
      subscriptions: [sub]
    })
    const recorder = createRecorder()
    manager = new MqttManager({
      profiles: { get: (id) => (id === profile.id ? profile : undefined) },
      sink: recorder.sink,
      batcher: { intervalMs: 5 }
    })
    await manager.connect(profile.id)
    await waitFor(() => recorder.subscriptions.find((e) => e.state === 'subscribed'))
    await manager.publish(profile.id, {
      topic: 'echo/1',
      payload: utf8Encode('ping'),
      qos: 1,
      retain: false,
      properties: { contentType: 'text/plain', userProperties: [{ key: 'k', value: 'v' }] }
    })
    const echo = await waitFor(() =>
      recorder.messages.find((m) => m.direction === 'in' && m.topic === 'echo/1')
    )

    expect(utf8Decode(echo.payload)).toBe('ping')
    expect(echo).toMatchObject({ qos: 1, properties: { contentType: 'text/plain' } })
    expect(fake.connects).toEqual([
      expect.objectContaining({ protocolVersion: 5, clientId: 'fake5-client', clean: true })
    ])
    expect(fake.subscribes[0].subscriptions).toEqual([
      { topic: 'echo/#', qos: 1, nl: false, rap: true, rh: 0 }
    ])
    const [publish] = fake.packets.filter((p) => p.cmd === 'publish')
    expect(publish).toMatchObject({
      cmd: 'publish',
      dup: false,
      qos: 1,
      topic: 'echo/1',
      properties: { contentType: 'text/plain', userProperties: { k: 'v' } }
    })
    expect(publish.messageId).toBeGreaterThan(0)
    expect(fake.packets.map((p) => p.cmd)).toEqual(['connect', 'subscribe', 'publish', 'puback'])
    expect(fake.maxInFlight).toBe(1)
    expect(fake.disconnectsSent).toEqual([])
  })
})

describe('FakeBroker5 enforcement (plain mqtt.js client)', () => {
  it('announces the configured CONNACK', async () => {
    const fake = await start({
      connack: {
        sessionPresent: true,
        properties: { maximumPacketSize: 1024, topicAliasMaximum: 5, maximumQoS: 1 }
      }
    })
    const { client } = rawClient(fake.port, { clean: false, clientId: 'keep' })
    const connack = await new Promise<unknown>((resolve) => client.once('connect', resolve))
    expect(connack).toMatchObject({
      sessionPresent: true,
      reasonCode: 0,
      properties: { maximumPacketSize: 1024, topicAliasMaximum: 5, maximumQoS: 1 }
    })
  })

  it('answers an MQTT 5 CONNECT with a raw 3.1.1 return code when asked to', async () => {
    const fake = await start({ connack: { returnCode: 1 } })
    const { client } = rawClient(fake.port)
    const error = await new Promise<Error>((resolve) => client.once('error', resolve))
    expect(error.message).toBe('Connection refused: Unacceptable protocol version')
  })

  it('disconnects with 0x93 when more QoS 1 publishes are in flight than Receive Maximum', async () => {
    const fake = await start({ connack: { properties: { receiveMaximum: 2 } }, ackDelayMs: 200 })
    const { client, disconnects } = rawClient(fake.port)
    await connected(client)
    for (let i = 0; i < 3; i++) client.publish('rm', 'x', { qos: 1 })
    await waitFor(() => disconnects.length === 1)
    expect(disconnects[0].reasonCode).toBe(0x93)
    expect(fake.maxInFlight).toBe(3)
    expect(fake.disconnectsSent.map((d) => d.code)).toEqual([0x93])
  })

  it('disconnects with 0x95 for a packet over Maximum Packet Size', async () => {
    const fake = await start({ connack: { properties: { maximumPacketSize: 100 } } })
    const { client, disconnects } = rawClient(fake.port)
    await connected(client)
    client.publish('small', 'x', { qos: 0 })
    client.publish('big', Buffer.alloc(200), { qos: 0 })
    await waitFor(() => disconnects.length === 1)
    expect(disconnects[0].reasonCode).toBe(0x95)
    expect(fake.packets.filter((p) => p.cmd === 'publish').map((p) => p.size)).toEqual([11, 209])
  })

  it('disconnects with 0x94 for a topic alias above Topic Alias Maximum', async () => {
    const fake = await start({ connack: { properties: { topicAliasMaximum: 2 } } })
    const { client, disconnects } = rawClient(fake.port)
    await connected(client)
    client.publish('a', 'x', { qos: 0, properties: { topicAlias: 2 } })
    // mqtt.js itself refuses 3 (out of the announced range): bypass it with a raw packet.
    client.stream.write(Buffer.from([0x30, 0x07, 0x00, 0x01, 0x62, 0x03, 0x23, 0x00, 0x03]))
    await waitFor(() => disconnects.length === 1)
    expect(disconnects[0].reasonCode).toBe(0x94)
  })

  it('refuses retain, QoS and subscriptions it did not announce', async () => {
    const cases: Array<[FakeBroker5Options['connack'], (client: MqttClient) => void, number]> = [
      [
        { properties: { retainAvailable: false } },
        (c) => c.publish('t', 'x', { retain: true }),
        0x9a
      ],
      [{ properties: { maximumQoS: 0 } }, (c) => c.publish('t', 'x', { qos: 1 }), 0x9b],
      [{ properties: { wildcardSubscriptionAvailable: false } }, (c) => c.subscribe('a/#'), 0xa2],
      [
        { properties: { sharedSubscriptionAvailable: false } },
        (c) => c.subscribe('$share/g/a'),
        0x9e
      ]
    ]
    for (const [connack, act, code] of cases) {
      const fake = await startFakeBroker5({ connack })
      const { client, disconnects } = rawClient(fake.port)
      await connected(client)
      act(client)
      await waitFor(() => disconnects.length === 1)
      expect(disconnects[0].reasonCode).toBe(code)
      await fake.close()
    }
  })

  it('runs the per-packet hooks (reason codes, held acks, DISCONNECT instead of an ack)', async () => {
    const fake = await start({
      onPublish: (packet) => {
        if (packet.topic === 'refused') return { reasonCode: 0x87 }
        if (packet.topic === 'held') return { hold: true }
        if (packet.topic === 'kick') return { disconnect: 0x97 }
        return undefined
      },
      onSubscribe: () => ({ reasonCodes: [0x87] })
    })
    const { client, disconnects } = rawClient(fake.port)
    await connected(client)
    const refused = await client.publishAsync('refused', 'x', { qos: 1 }).catch((e: Error) => e)
    expect(String(refused)).toContain('Not authorized')
    const suback = await client.subscribeAsync('s/#', { qos: 1 }).catch((e: Error) => e)
    expect(String(suback)).toContain('Subscribe error: Not authorized')
    let held = false
    client.publish('held', 'x', { qos: 1 }, () => (held = true))
    await sleep(100)
    expect(held).toBe(false)
    client.publish('kick', 'x', { qos: 1 })
    await waitFor(() => disconnects.length === 1)
    expect(disconnects[0].reasonCode).toBe(0x97)
  })
})
