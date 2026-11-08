import { EventEmitter } from 'node:events'
import type { Client } from 'aedes'
import type { IClientOptions, MqttClient } from 'mqtt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import type { ConnectionProfile, StatusEvent } from '@shared/models'
import { utf8Encode } from '@shared/payload'
import { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import { TLS_READ_TIMEOUT_MS } from '../../../src/main/services/mqtt/tls-material'
import { fakeConnector } from './helpers/fake-client'
import {
  createRecorder,
  freePort,
  type Recorder,
  sleep,
  startBroker,
  type TestBroker,
  waitFor
} from './helpers/broker'

let manager: MqttManager | null = null
let server: TestBroker | null = null

afterEach(async () => {
  await manager?.disposeAll(1000)
  await server?.close()
  manager = null
  server = null
})

function setup(overrides: Partial<ConnectionProfile>): {
  profile: ConnectionProfile
  recorder: Recorder
  manager: MqttManager
} {
  const profile = createConnectionProfile({
    host: '127.0.0.1',
    protocolVersion: 4,
    clientId: 'mqttin_test',
    autoReconnect: false,
    connectTimeout: 2000,
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

describe('MqttSession failure handling', () => {
  it('reports a refused TCP connection as a human error', async () => {
    const port = await freePort()
    const { profile, recorder, manager } = setup({ port })
    await manager.connect(profile.id)
    const failed = await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    expect(failed.error).toBe(`Connection refused — is a broker listening on 127.0.0.1:${port}?`)
    expect(recorder.logs.some((l) => l.level === 'error' && l.message === failed.error)).toBe(true)
    expect(manager.getSessions()[0]).toMatchObject({ status: 'error', error: failed.error })
  })

  it('keeps retrying a refused connection while auto-reconnect is on', async () => {
    const port = await freePort()
    const { profile, recorder, manager } = setup({ port, autoReconnect: true, reconnectPeriod: 50 })
    await manager.connect(profile.id)
    const reconnecting = await waitFor(() =>
      recorder.status.find((s) => s.status === 'reconnecting')
    )
    expect(reconnecting.error).toContain('Connection refused')
    await waitFor(() => recorder.logs.some((l) => l.message.startsWith('Reconnecting (attempt 2)')))
    await manager.disconnect(profile.id)
    expect(recorder.status.at(-1)?.status).toBe('disconnected')
  })

  it('stops reconnecting after a fatal CONNACK (bad credentials)', async () => {
    server = await startBroker({
      authenticate: (_client, _username, _password, done) =>
        done(Object.assign(new Error('Auth error'), { returnCode: 4 as const }), false)
    })
    const { profile, recorder, manager } = setup({
      port: server.port,
      username: 'bob',
      password: 'wrong',
      autoReconnect: true,
      reconnectPeriod: 50
    })
    await manager.connect(profile.id)
    const failed = await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    expect(failed.error).toBe('Connection refused: bad user name or password')
    await sleep(250)
    expect(recorder.status.some((s) => s.status === 'reconnecting')).toBe(false)
    expect(recorder.status.at(-1)?.status).toBe('error')
    const debug = recorder.logs.find((l) => l.message === '→ CONNECT')
    expect(debug?.detail).toContain('"password":"******"')
    expect(debug?.detail).not.toContain('wrong')
  })

  it('retries a transient CONNACK refusal (server unavailable)', async () => {
    let attempts = 0
    server = await startBroker({
      authenticate: (_client, _username, _password, done) => {
        attempts++
        if (attempts === 1)
          done(Object.assign(new Error('busy'), { returnCode: 3 as const }), false)
        else done(null, true)
      }
    })
    const { profile, recorder, manager } = setup({
      port: server.port,
      autoReconnect: true,
      reconnectPeriod: 50
    })
    await manager.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'connected'))
    expect(
      recorder.status.some(
        (s) => s.status === 'reconnecting' && s.error === 'Connection refused: server unavailable'
      )
    ).toBe(true)
  })

  it('reconnects after the broker drops the connection and resubscribes', async () => {
    server = await startBroker()
    const clients: Client[] = []
    server.broker.on('clientReady', (client) => clients.push(client))
    const sub = createSubscription({ topic: 'again/#', qos: 1 })
    const { profile, recorder, manager } = setup({
      port: server.port,
      autoReconnect: true,
      reconnectPeriod: 50,
      subscriptions: [sub]
    })
    await manager.connect(profile.id)
    await waitFor(() => recorder.subscriptions.find((e) => e.state === 'subscribed'))

    const subscribedBefore = recorder.subscriptions.filter((e) => e.state === 'subscribed').length
    clients[0].close()

    await waitFor(() => recorder.status.find((s) => s.status === 'reconnecting'))
    expect(recorder.subscriptions.some((e) => e.state === 'idle')).toBe(true)
    await waitFor(() => recorder.status.filter((s) => s.status === 'connected').length === 2)
    await waitFor(
      () => recorder.subscriptions.filter((e) => e.state === 'subscribed').length > subscribedBefore
    )
    expect(manager.getSessions()[0].subscriptions[0]).toMatchObject({ state: 'subscribed' })
  })

  it('reports the broker closing the connection when auto-reconnect is off', async () => {
    server = await startBroker()
    const clients: Client[] = []
    server.broker.on('clientReady', (client) => clients.push(client))
    const { profile, recorder, manager } = setup({ port: server.port })
    await manager.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'connected'))
    clients[0].close()
    const failed = await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    expect(failed.error).toBeTruthy()
  })

  it('replaces the session on a second connect and forgets it on request', async () => {
    server = await startBroker()
    const { profile, recorder, manager } = setup({ port: server.port })
    await manager.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'connected'))
    await manager.connect(profile.id)
    await waitFor(() => recorder.status.filter((s) => s.status === 'connected').length === 2)
    const statuses = recorder.status.map((s) => s.status)
    expect(statuses).toEqual([
      'connecting',
      'connected',
      'disconnecting',
      'disconnected',
      'connecting',
      'connected'
    ])
    expect(manager.getSessions()).toHaveLength(1)
    await manager.forget(profile.id)
    expect(manager.getSessions()).toEqual([])
  })

  it('retries after an error without reporting disconnected in between', async () => {
    const port = await freePort()
    const { profile, recorder, manager } = setup({ port })
    await manager.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    await manager.connect(profile.id)
    await waitFor(() => recorder.status.filter((s) => s.status === 'error').length === 2)
    expect(recorder.status.map((s) => s.status)).toEqual([
      'connecting',
      'error',
      'connecting',
      'error'
    ])
    // An explicit disconnect still clears the error.
    await manager.disconnect(profile.id)
    expect(recorder.status.at(-1)).toMatchObject({ status: 'disconnected' })
    expect(recorder.status.at(-1)?.error).toBeUndefined()
  })

  it('reports an unreadable CA file without connecting', async () => {
    const { profile, recorder, manager } = setup({ protocol: 'mqtts', port: 8883 })
    profile.tls.caPath = '/definitely/missing/ca.pem'
    await manager.connect(profile.id)
    const failed = await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    expect(failed.error).toBe('Cannot read CA file /definitely/missing/ca.pem: file not found')
  })

  it('ends in error when mqtt.js refuses the TLS material and cannot even be ended', async () => {
    // What mqtt.js does with a key it cannot decrypt: connect() throws from tls.connect before
    // a stream exists, and end() then throws on the missing stream.
    class RefusingClient extends EventEmitter {
      disconnecting = false
      stream = undefined
      constructor(
        readonly url: string,
        readonly options: IClientOptions
      ) {
        super()
      }
      connect(): never {
        const message = 'error:1C800064:Provider routines::bad decrypt'
        throw Object.assign(new Error(message), { code: 'ERR_OSSL_BAD_DECRYPT' })
      }
      end(): never {
        throw new TypeError("Cannot read properties of undefined (reading 'on')")
      }
    }
    const profile = createConnectionProfile({ host: '127.0.0.1', autoReconnect: true })
    const recorder = createRecorder()
    manager = new MqttManager({
      profiles: { get: () => profile },
      sink: recorder.sink,
      connect: (url, options) => new RefusingClient(url, options) as unknown as MqttClient
    })
    await manager.connect(profile.id)
    const message = 'Cannot decrypt the private key — check the passphrase'
    expect(recorder.status.map((s) => [s.status, s.error])).toEqual([
      ['connecting', undefined],
      ['error', message]
    ])
    expect(recorder.logs.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([
      message
    ])
    expect(manager.getSessions()).toEqual([expect.objectContaining({ status: 'error' })])
  })

  it('gives up on a TLS file that never loads, while other sessions keep publishing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const tls = createConnectionProfile({ protocol: 'mqtts', host: 'broker', port: 8883 })
      tls.tls.caPath = String.raw`\\192.0.2.1\share\ca.pem`
      const plain = createConnectionProfile({ host: '127.0.0.1' })
      const profiles = new Map([tls, plain].map((p) => [p.id, p]))
      const recorder = createRecorder()
      const connector = fakeConnector()
      manager = new MqttManager({
        profiles: { get: (id) => profiles.get(id) },
        sink: recorder.sink,
        connect: connector.connect,
        readFile: () => new Promise<Buffer>(() => {}),
        batcher: { intervalMs: 5 }
      })
      await manager.connect(tls.id)
      await manager.connect(plain.id)
      connector.clients[0].connack()
      const message = { topic: 't', payload: utf8Encode('x'), qos: 1 as const, retain: false }
      await manager.publish(plain.id, message)
      expect(manager.getSessions().map((s) => s.status)).toEqual(['connecting', 'connected'])

      await vi.advanceTimersByTimeAsync(TLS_READ_TIMEOUT_MS)
      await manager.publish(plain.id, message)
      const status = (id: string): StatusEvent | undefined =>
        recorder.status.filter((s) => s.connectionId === id).at(-1)
      expect(status(tls.id)).toMatchObject({
        status: 'error',
        error: String.raw`Cannot reach \\192.0.2.1\share\ca.pem (network share unavailable)`
      })
      expect(status(plain.id)?.status).toBe('connected')
      expect(connector.clients).toHaveLength(1) // the TLS session never created a client
      expect(connector.clients[0].published).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
