import { describe, expect, it } from 'vitest'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import type { ConnectionProfile, MqttMessage } from '@shared/models'
import { utf8Encode } from '@shared/payload'
import { MqttSession } from '../../../src/main/services/mqtt/mqtt-session'
import { createRecorder, type Recorder, waitFor } from './helpers/broker'
import { fakeConnector, type FakeMqttClient } from './helpers/fake-client'

interface Harness {
  session: MqttSession
  client: FakeMqttClient
  recorder: Recorder
  messages: MqttMessage[]
}

function start(overrides: Partial<ConnectionProfile> = {}): Harness {
  const profile = createConnectionProfile({
    clientId: '',
    protocolVersion: 5,
    autoReconnect: true,
    reconnectPeriod: 1000,
    ...overrides
  })
  const recorder = createRecorder()
  const messages: MqttMessage[] = []
  const connector = fakeConnector()
  const session = new MqttSession({
    profile,
    sink: recorder.sink,
    pushMessage: (message) => messages.push(message),
    connect: connector.connect
  })
  session.connect()
  const [client] = connector.clients
  return { session, client, recorder, messages }
}

const lastStatus = (h: Harness): string | undefined => h.recorder.status.at(-1)?.status

describe('MqttSession (MQTT 5 behaviour, scripted client)', () => {
  it('uses the client id assigned by the broker', () => {
    const h = start()
    expect(h.client.options.manualConnect).toBe(true)
    h.client.connack({ properties: { assignedClientIdentifier: 'broker-assigned-1' } })
    expect(h.recorder.status.at(-1)).toMatchObject({
      status: 'connected',
      clientId: 'broker-assigned-1',
      sessionPresent: false
    })
    expect(h.session.snapshot().clientId).toBe('broker-assigned-1')
  })

  it('sends MQTT 5 subscription options and reports refusals with the reason', async () => {
    const plain = createSubscription({
      topic: 'a/#',
      qos: 1,
      noLocal: true,
      retainAsPublished: true,
      retainHandling: 2,
      subscriptionIdentifier: 7
    })
    const shared = createSubscription({ topic: '$share/g/b', noLocal: true })
    const h = start({ subscriptions: [plain, shared] })
    h.client.subackCode = 0x87
    h.client.connack()
    await waitFor(() => h.recorder.subscriptions.filter((e) => e.state === 'failed').length === 2)

    expect(h.client.subscribed).toEqual([
      {
        topic: 'a/#',
        options: { qos: 1, nl: true, rap: true, rh: 2, properties: { subscriptionIdentifier: 7 } }
      },
      // Retain As Published is on by default (createSubscription); No Local never on a share.
      { topic: '$share/g/b', options: { qos: 0, nl: false, rap: true, rh: 0 } }
    ])
    expect(h.recorder.subscriptions.at(-1)?.error).toBe('Not authorized (0x87)')
  })

  it('converts MQTT 5 properties of incoming messages', () => {
    const h = start()
    h.client.connack()
    h.client.receive({
      topic: 'p',
      payload: Buffer.from('x'),
      qos: 1,
      retain: false,
      dup: true,
      properties: {
        correlationData: Buffer.from('req-1'),
        subscriptionIdentifier: 3,
        userProperties: { k: ['1', '2'] }
      }
    })
    expect(h.messages[0]).toMatchObject({
      direction: 'in',
      dup: true,
      properties: {
        correlationData: 'req-1',
        subscriptionIdentifier: [3],
        userProperties: [
          { key: 'k', value: '1' },
          { key: 'k', value: '2' }
        ]
      }
    })
  })

  it('stops for good on a fatal CONNACK', () => {
    const h = start()
    h.client.connack({ reasonCode: 0x86, properties: { reasonString: 'unknown user' } })
    expect(h.recorder.status.at(-1)).toMatchObject({
      status: 'error',
      error: 'Connection refused: bad user name or password — unknown user'
    })
    expect(h.client.ended).toEqual([true])
    expect(h.client.options.reconnectPeriod).toBe(0)
    h.client.drop()
    expect(lastStatus(h)).toBe('error')
  })

  it('keeps reconnecting after a transient CONNACK refusal', () => {
    const h = start()
    h.client.connack({ reasonCode: 0x89 })
    h.client.drop()
    expect(h.recorder.status.at(-1)).toMatchObject({
      status: 'reconnecting',
      error: 'Connection refused: server busy'
    })
    expect(h.client.ended).toEqual([])
  })

  it('reports a broker DISCONNECT as the reason of the drop', () => {
    const h = start({ autoReconnect: false })
    h.client.connack()
    h.client.serverDisconnect({ reasonCode: 0x8b })
    h.client.drop()
    expect(h.recorder.status.at(-1)).toMatchObject({
      status: 'error',
      error: 'Disconnected by the broker: server shutting down'
    })
    expect(h.recorder.logs.some((l) => l.level === 'warn' && l.message.includes('(0x8b)'))).toBe(
      true
    )
  })

  it('restores subscriptions after a reconnect unless the broker kept the session', async () => {
    const sub = createSubscription({ topic: 's/#' })
    const h = start({ subscriptions: [sub], clean: false, clientId: 'fixed' })
    h.client.connack({ sessionPresent: true })
    await waitFor(() => h.recorder.subscriptions.find((e) => e.state === 'subscribed'))
    expect(h.client.subscribed).toHaveLength(1)

    h.client.drop()
    expect(h.recorder.subscriptions.at(-1)?.state).toBe('idle')
    h.client.emit('reconnect')
    h.client.connack({ sessionPresent: true })
    expect(h.client.subscribed).toHaveLength(1)
    expect(h.recorder.subscriptions.at(-1)?.state).toBe('subscribed')

    h.client.drop()
    h.client.connack({ sessionPresent: false })
    await waitFor(() => h.client.subscribed.length === 2)
  })

  it('checks the limits announced in the CONNACK before publishing', async () => {
    const h = start()
    h.client.connack({ properties: { retainAvailable: false, maximumQoS: 1 } })
    const base = { topic: 't', payload: utf8Encode('x'), qos: 0 as const, retain: false }
    await expect(h.session.publish({ ...base, retain: true })).rejects.toThrow(
      'The broker does not support retained messages'
    )
    await expect(h.session.publish({ ...base, qos: 2 })).rejects.toThrow(
      'The broker supports QoS 0 and 1 only'
    )
    expect(h.client.published).toHaveLength(0)
    expect(h.recorder.logs.filter((l) => l.level === 'error')).toHaveLength(2)
  })

  it('publishes MQTT 5 properties and reports the outgoing message', async () => {
    const h = start()
    h.client.connack()
    await h.session.publish({
      topic: 't',
      payload: utf8Encode('x'),
      qos: 1,
      retain: false,
      properties: { correlationData: 'c', userProperties: [{ key: 'a', value: 'b' }] }
    })
    expect(h.client.published[0].options).toEqual({
      qos: 1,
      retain: false,
      properties: { correlationData: Buffer.from('c'), userProperties: { a: 'b' } }
    })
    expect(h.messages[0]).toMatchObject({
      direction: 'out',
      properties: { correlationData: 'c', userProperties: [{ key: 'a', value: 'b' }] }
    })
  })

  it('rejects QoS 0 publishes stuck on a dropped connection', async () => {
    const h = start()
    h.client.connack()
    h.client.completePublishes = false
    const pending = h.session.publish({
      topic: 't',
      payload: utf8Encode('x'),
      qos: 0,
      retain: false
    })
    h.client.drop()
    await expect(pending).rejects.toThrow('Connection lost')
    expect(lastStatus(h)).toBe('reconnecting')
  })

  it('resets the connection when the packet writer throws half way through a PUBLISH', async () => {
    const h = start()
    h.client.connack()
    // What mqtt-packet does for a field it cannot encode: it throws after writing the header.
    h.client.publish = (): never => {
      throw Object.assign(new TypeError('The "chunk" argument must be of type string'), {
        code: 'ERR_INVALID_ARG_TYPE'
      })
    }
    await expect(
      h.session.publish({ topic: 't', payload: utf8Encode('x'), qos: 0, retain: false })
    ).rejects.toThrow('The message could not be sent; the connection is reset')
    expect(h.client.stream.destroyed).toBe(true)
    const reason = 'A message could not be written; the connection was reset'
    expect(h.recorder.logs.some((l) => l.level === 'error' && l.message === reason)).toBe(true)
    expect(h.messages).toEqual([]) // nothing is shown as sent
    h.client.drop()
    expect(h.recorder.status.at(-1)).toMatchObject({ status: 'reconnecting', error: reason })
  })

  it('describes transport errors without a code (WebSocket handshake)', () => {
    const h = start({ protocol: 'ws', port: 8083, autoReconnect: false })
    h.client.stream.emit('error', new Error('Unexpected server response: 404'))
    h.client.drop()
    expect(h.recorder.status.at(-1)).toMatchObject({
      status: 'error',
      error: 'WebSocket handshake failed (HTTP 404) — check the WebSocket path'
    })
  })

  it('disconnects with a DISCONNECT packet when connected', async () => {
    const h = start()
    h.client.connack()
    await h.session.disconnect()
    expect(h.client.ended[0]).toBe(false)
    expect(h.recorder.status.map((s) => s.status).slice(-2)).toEqual([
      'disconnecting',
      'disconnected'
    ])
    await expect(
      h.session.publish({ topic: 't', payload: new Uint8Array(), qos: 0, retain: false })
    ).rejects.toThrow('Not connected')
  })
})
