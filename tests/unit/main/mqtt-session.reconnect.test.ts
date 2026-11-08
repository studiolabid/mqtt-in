import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectionProfile } from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import { MqttSession } from '../../../src/main/services/mqtt/mqtt-session'
import {
  formatDelay,
  MAX_BACKOFF_MS,
  ReconnectBackoff
} from '../../../src/main/services/mqtt/reconnect-backoff'
import { createRecorder, freePort, type Recorder, sleep, waitFor } from './helpers/broker'
import { fakeConnector, type FakeMqttClient } from './helpers/fake-client'
import { type FakeBroker5, startFakeBroker5 } from './helpers/fake-broker5'

interface Harness {
  client: FakeMqttClient
  recorder: Recorder
}

/** An MQTT 5 session on the scripted client (auto-reconnect on, 1 s period). */
function start(overrides: Partial<ConnectionProfile> = {}): Harness {
  const profile = createConnectionProfile({
    protocolVersion: 5,
    autoReconnect: true,
    reconnectPeriod: 1000,
    ...overrides
  })
  const recorder = createRecorder()
  const connector = fakeConnector()
  const session = new MqttSession({
    profile,
    sink: recorder.sink,
    pushMessage: () => {},
    connect: connector.connect
  })
  void session.connect()
  return { client: connector.clients[0], recorder }
}

const statuses = (h: Harness): string[] => h.recorder.status.map((s) => s.status)
const errorLogs = (h: Harness): string[] =>
  h.recorder.logs.filter((l) => l.level === 'error').map((l) => l.message)

let broker: FakeBroker5 | null = null
let manager: MqttManager | null = null

afterEach(async () => {
  vi.restoreAllMocks()
  await manager?.disposeAll(1000)
  await broker?.close()
  manager = null
  broker = null
})

/** A manager whose only profile is `profile` (events into a recorder). */
function managerFor(profile: ConnectionProfile): Recorder {
  const recorder = createRecorder()
  manager = new MqttManager({
    profiles: { get: (id) => (id === profile.id ? profile : undefined) },
    sink: recorder.sink,
    batcher: { intervalMs: 5 }
  })
  return recorder
}

describe('ReconnectBackoff', () => {
  it('doubles up to 60 s with ±20 % jitter, never below 100 ms, and starts over on reset', () => {
    const exact = new ReconnectBackoff(1000, () => 0.5)
    const waits = Array.from({ length: 9 }, () => exact.next())
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000])
    exact.reset()
    expect(exact.next()).toBe(1000)
    expect(new ReconnectBackoff(1000, () => 0).next()).toBe(800)
    expect(new ReconnectBackoff(1000, () => 0.999_999).next()).toBe(1200)
    expect(new ReconnectBackoff(100, () => 0).next()).toBe(100) // LIMITS.reconnectPeriodMs.min
    const capped = new ReconnectBackoff(50_000, () => 0.999_999)
    expect([capped.next(), capped.next()]).toEqual([MAX_BACKOFF_MS, MAX_BACKOFF_MS])
    // A profile period above the cap is kept as it is.
    expect(new ReconnectBackoff(120_000, () => 0.5).next()).toBe(120_000)
  })

  it('formats waits for the log', () => {
    expect([formatDelay(150), formatDelay(4000), formatDelay(7380), formatDelay(60_000)]).toEqual([
      '150 ms',
      '4 s',
      '7.4 s',
      '1 min'
    ])
  })
})

describe('auto-reconnect (MQ-09)', () => {
  it('waits twice as long after every failed attempt, and the profile period after a CONNACK', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // no jitter
    const h = start()
    const waits = [h.client.options.reconnectPeriod]
    for (let attempt = 1; attempt <= 8; attempt++) {
      h.client.drop()
      h.client.emit('reconnect')
      waits.push(h.client.options.reconnectPeriod)
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000])
    const retries = h.recorder.logs.filter((l) => l.message.startsWith('Retrying in '))
    expect(retries.slice(0, 4).map((l) => l.message)).toEqual([
      'Retrying in 1 s',
      'Retrying in 2 s',
      'Retrying in 4 s',
      'Retrying in 8 s'
    ])
    h.client.connack()
    expect(h.client.options.reconnectPeriod).toBe(1000)
    h.client.drop()
    expect(h.recorder.logs.at(-1)?.message).toBe('Connection lost — reconnecting in 1 s')
    h.client.emit('reconnect')
    expect(h.client.options.reconnectPeriod).toBe(2000)
    expect(h.recorder.logs.at(-1)?.message).toBe('Reconnecting (attempt 1)…')
  })

  it('makes mqtt.js itself wait longer between attempts', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const profile = createConnectionProfile({
      host: '127.0.0.1',
      port: await freePort(),
      clientId: 'backoff',
      reconnectPeriod: 100
    })
    const recorder = managerFor(profile)
    await manager?.connect(profile.id)
    const attemptAt = (n: number): number | undefined =>
      recorder.logs.find((l) => l.message === `Reconnecting (attempt ${n})…`)?.timestamp
    await waitFor(() => attemptAt(3), 6000, 'attempt 3')
    const [first, second, third] = [attemptAt(1), attemptAt(2), attemptAt(3)] as number[]
    // A fixed period would give ~100 ms gaps; timers never fire early.
    expect(second - first).toBeGreaterThanOrEqual(195)
    expect(third - second).toBeGreaterThanOrEqual(395)
  })

  it('stops after one attempt when the broker refuses the Last Will (CONNACK 0x9A)', async () => {
    broker = await startFakeBroker5({ connack: { reasonCode: 0x9a } })
    const profile = createConnectionProfile({
      host: '127.0.0.1',
      port: broker.port,
      clientId: 'will',
      reconnectPeriod: 100,
      will: { ...createConnectionProfile().will, enabled: true, topic: 'w', retain: true }
    })
    const recorder = managerFor(profile)
    await manager?.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    await sleep(400)
    const message = "The broker does not support the Last Will's retain flag — change the Last Will"
    expect(recorder.status.map((s) => [s.status, s.error])).toEqual([
      ['connecting', undefined],
      ['error', message]
    ])
    expect(broker.connects).toHaveLength(1)
    const errors = recorder.logs.filter((l) => l.level === 'error')
    expect(errors).toEqual([
      expect.objectContaining({
        message,
        detail: 'Reason code 0x9a; not retrying — fix the settings first'
      })
    ])
  })

  it('ends the session on a TLS certificate error instead of retrying', () => {
    const h = start({ protocol: 'mqtts', host: '203.0.113.5', port: 8883 })
    const err = Object.assign(new Error("Hostname/IP does not match certificate's altnames"), {
      code: 'ERR_TLS_CERT_ALTNAME_INVALID'
    })
    // mqtt.js emits a TLS error twice (connect/tls.js and the stream handler).
    h.client.emit('error', err)
    h.client.emit('error', err)
    h.client.drop()
    expect(statuses(h)).toEqual(['connecting', 'error'])
    expect(h.recorder.status.at(-1)?.error).toMatch(/^The certificate does not match the host name/)
    expect(h.client.ended).toEqual([true])
    expect(h.client.options.reconnectPeriod).toBe(0)
    const errors = h.recorder.logs.filter((l) => l.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].detail).toContain('not retrying')
  })

  it('logs an error mqtt.js reports twice only once per attempt', () => {
    const h = start({ protocol: 'mqtts', host: 'broker', port: 1883 })
    const reset = Object.assign(
      new Error('Client network socket disconnected before secure TLS connection was established'),
      { code: 'ECONNRESET' }
    )
    const hint =
      'TLS handshake failed — the broker closed the connection. Is this port TLS-enabled (usually 8883)?'
    h.client.emit('error', reset)
    h.client.emit('error', reset)
    h.client.drop()
    expect(errorLogs(h)).toEqual([hint])
    expect(h.recorder.status.at(-1)).toMatchObject({ status: 'reconnecting', error: hint })
    h.client.emit('reconnect')
    h.client.emit('error', reset)
    h.client.emit('error', Object.assign(new Error(reset.message), { code: 'ECONNRESET' }))
    expect(errorLogs(h)).toEqual([hint, hint]) // once per attempt
  })
})

describe('broker DISCONNECTs that end the session (MQ-10)', () => {
  it.each<[number, Record<string, string>, string]>([
    [0x8e, {}, 'Another client connected with the same client ID'],
    [0x8a, {}, 'Disconnected by the broker: banned'],
    [
      0x9c,
      { serverReference: 'eu.example.com:1883' },
      'The broker asks to use another server: eu.example.com:1883'
    ],
    [
      0x9d,
      { serverReference: 'new.example.com' },
      'The broker moved to another server: new.example.com'
    ]
  ])('DISCONNECT %i ends in error, without reconnecting', (code, properties, message) => {
    const h = start()
    h.client.connack()
    h.client.serverDisconnect({ reasonCode: code, properties })
    h.client.drop()
    expect(h.recorder.status.at(-1)).toMatchObject({ status: 'error', error: message })
    expect(statuses(h)).not.toContain('reconnecting')
    expect(h.client.ended).toEqual([true])
    expect(h.client.options.reconnectPeriod).toBe(0)
    expect(h.recorder.logs.filter((l) => l.level === 'error')).toEqual([
      expect.objectContaining({ message, detail: expect.stringMatching(/^Not reconnecting: /) })
    ])
  })

  it('keeps reconnecting after a DISCONNECT a later attempt can get past', () => {
    const h = start()
    h.client.connack()
    h.client.serverDisconnect({ reasonCode: 0x8b }) // server shutting down
    h.client.drop()
    expect(h.recorder.status.at(-1)).toMatchObject({
      status: 'reconnecting',
      error: 'Disconnected by the broker: server shutting down'
    })
    expect(h.client.ended).toEqual([])
  })

  it('stops two clients with one client ID from kicking each other (real broker)', async () => {
    broker = await startFakeBroker5({})
    const profile = createConnectionProfile({
      host: '127.0.0.1',
      port: broker.port,
      clientId: 'twin',
      reconnectPeriod: 100
    })
    const recorder = managerFor(profile)
    await manager?.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'connected'))
    broker.disconnectAll(0x8e)
    await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    await sleep(400)
    expect(recorder.status.at(-1)).toMatchObject({
      status: 'error',
      error: 'Another client connected with the same client ID'
    })
    expect(recorder.status.map((s) => s.status)).not.toContain('reconnecting')
    expect(broker.connects).toHaveLength(1)
  })
})
