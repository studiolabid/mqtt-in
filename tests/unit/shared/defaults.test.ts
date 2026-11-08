import { describe, expect, it } from 'vitest'
import {
  APP_NAME,
  brokerUrl,
  createConnectionProfile,
  createSubscription,
  DEFAULT_PORTS,
  DEFAULT_SETTINGS,
  generateClientId,
  isGeneratedClientId,
  isTlsProtocol,
  isWebSocketProtocol,
  LIMITS,
  NEUTRAL_COLOR,
  newId,
  PALETTE,
  pickColor,
  protocolLabel,
  PROTOCOL_VERSIONS
} from '@shared/defaults'
import type { ConnectionProfile, MqttProtocol, MqttProtocolVersion } from '@shared/models'
import { UUID_V4 } from './helpers'

const CLIENT_ID = /^mqtey_[0-9a-f]{8}$/

describe('constants', () => {
  it('defines the default port of every transport', () => {
    expect(DEFAULT_PORTS).toEqual({ mqtt: 1883, mqtts: 8883, ws: 8083, wss: 8084 })
  })

  it('has a palette of unique #rrggbb colors', () => {
    expect(PALETTE.length).toBeGreaterThan(0)
    expect(new Set(PALETTE).size).toBe(PALETTE.length)
    for (const color of PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('lists MQTT 5.0, 3.1.1 and 3.1', () => {
    expect(PROTOCOL_VERSIONS.map((v) => v.value)).toEqual([5, 4, 3])
    expect(PROTOCOL_VERSIONS.map((v) => v.label)).toEqual(['MQTT 5.0', 'MQTT 3.1.1', 'MQTT 3.1'])
  })

  it('labels every protocol version', () => {
    expect(protocolLabel(3)).toBe('MQTT 3.1')
    expect(protocolLabel(4)).toBe('MQTT 3.1.1')
    expect(protocolLabel(5)).toBe('MQTT 5.0')
    // Old or hand-edited data can carry another number.
    expect(protocolLabel(JSON.parse('6') as MqttProtocolVersion)).toBe('MQTT 6')
  })

  it('has default settings within the shared limits', () => {
    const { min, max } = LIMITS.maxMessagesPerConnection
    expect(DEFAULT_SETTINGS.maxMessagesPerConnection).toBeGreaterThanOrEqual(min)
    expect(DEFAULT_SETTINGS.maxMessagesPerConnection).toBeLessThanOrEqual(max)
    expect(DEFAULT_SETTINGS.defaultViewFormat).toBe('auto')
    expect(LIMITS.maxTopicBytes).toBe(65_535)
    expect(LIMITS.repeatIntervalMs.min).toBe(10)
  })

  it('defines the connection ranges used by the form, the schema and the client options', () => {
    expect(LIMITS.reconnectPeriodMs).toEqual({ min: 100, max: 86_400_000 })
    expect(LIMITS.connectTimeoutMs).toEqual({ min: 0, max: 3_600_000 })
    expect(LIMITS.keepaliveS).toEqual({ min: 0, max: 65_535 })
  })

  it('creates profiles within those ranges', () => {
    const profile = createConnectionProfile()
    const within = (value: number, range: { min: number; max: number }): boolean =>
      value >= range.min && value <= range.max
    expect(within(profile.reconnectPeriod, LIMITS.reconnectPeriodMs)).toBe(true)
    expect(within(profile.connectTimeout, LIMITS.connectTimeoutMs)).toBe(true)
    expect(within(profile.keepalive, LIMITS.keepaliveS)).toBe(true)
  })
})

describe('ids', () => {
  it('newId returns unique v4 UUIDs', () => {
    const ids = Array.from({ length: 50 }, () => newId())
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('generateClientId returns mqtey_ + 8 lower-case hex chars', () => {
    expect(APP_NAME).toBe('mqtey')
    const ids = Array.from({ length: 50 }, () => generateClientId())
    for (const id of ids) expect(id).toMatch(CLIENT_ID)
    expect(new Set(ids).size).toBeGreaterThan(45)
  })

  it('generateClientId fits the MQTT 3.1 limit of 23 characters', () => {
    expect(generateClientId().length).toBeLessThanOrEqual(23)
  })

  it('generateClientId accepts a custom prefix', () => {
    expect(generateClientId('sensor')).toMatch(/^sensor_[0-9a-f]{8}$/)
  })

  it('isGeneratedClientId recognizes the ids mqtey generates, and only those', () => {
    for (let i = 0; i < 20; i++) expect(isGeneratedClientId(generateClientId())).toBe(true)
    expect(isGeneratedClientId('mqtey_0a1b2c3d')).toBe(true)
    for (const id of [
      '',
      'plant-gw-1',
      'mqtey_0A1B2C3D',
      'mqtey_0a1b2c3',
      'mqtey_0a1b2c3d4',
      'xmqtey_0a1b2c3d',
      'mqtey-0a1b2c3d',
      generateClientId('sensor')
    ]) {
      expect(isGeneratedClientId(id), id).toBe(false)
    }
  })
})

describe('pickColor / default colors', () => {
  it('maps indexes onto the palette and wraps around', () => {
    expect(pickColor(0)).toBe(PALETTE[0])
    expect(pickColor(3)).toBe(PALETTE[3])
    expect(pickColor(PALETTE.length)).toBe(PALETTE[0])
    expect(pickColor(PALETTE.length * 5 + 2)).toBe(PALETTE[2])
  })

  it('wraps negative indexes from the end', () => {
    expect(pickColor(-1)).toBe(PALETTE[PALETTE.length - 1])
    expect(pickColor(-PALETTE.length)).toBe(PALETTE[0])
  })

  it('always returns a palette color for fractional or non-finite indexes', () => {
    expect(pickColor(1.7)).toBe(PALETTE[1])
    expect(pickColor(-0.5)).toBe(PALETTE[PALETTE.length - 1])
    expect(pickColor(Number.NaN)).toBe(PALETTE[0])
    expect(pickColor(Number.POSITIVE_INFINITY)).toBe(PALETTE[0])
  })

  it('defaults to the monochrome look: mono accent and the neutral color first', () => {
    expect(DEFAULT_SETTINGS.accent).toBe('zinc')
    expect(PALETTE[0]).toBe(NEUTRAL_COLOR)
    expect(new Set(PALETTE).size).toBe(PALETTE.length)
    expect(createSubscription().color).toBe(NEUTRAL_COLOR)
    expect(createConnectionProfile().color).toBe(NEUTRAL_COLOR)
    expect(createSubscription({ color: '#22c55e' }).color).toBe('#22c55e')
  })
})

describe('isTlsProtocol / isWebSocketProtocol', () => {
  it.each<[MqttProtocol, boolean, boolean]>([
    ['mqtt', false, false],
    ['mqtts', true, false],
    ['ws', false, true],
    ['wss', true, true]
  ])('%s → tls %s, websocket %s', (protocol, tls, ws) => {
    expect(isTlsProtocol(protocol)).toBe(tls)
    expect(isWebSocketProtocol(protocol)).toBe(ws)
  })
})

describe('brokerUrl', () => {
  type Endpoint = Pick<ConnectionProfile, 'protocol' | 'host' | 'port' | 'path'>
  const endpoint = (overrides: Partial<Endpoint>): Endpoint => ({
    protocol: 'mqtt',
    host: 'broker.local',
    port: 1883,
    path: '/mqtt',
    ...overrides
  })

  it.each<[Partial<Endpoint>, string]>([
    [{ protocol: 'mqtt' }, 'mqtt://broker.local:1883'],
    [{ protocol: 'mqtts', port: 8883 }, 'mqtts://broker.local:8883'],
    [{ protocol: 'ws', port: 8083 }, 'ws://broker.local:8083/mqtt'],
    [{ protocol: 'wss', port: 8084 }, 'wss://broker.local:8084/mqtt']
  ])('%j → %s', (overrides, expected) => {
    expect(brokerUrl(endpoint(overrides))).toBe(expected)
  })

  it('ignores the path for TCP transports', () => {
    expect(brokerUrl(endpoint({ protocol: 'mqtts', path: '/ignored', port: 8883 }))).toBe(
      'mqtts://broker.local:8883'
    )
  })

  it('adds a missing leading slash to the WebSocket path', () => {
    expect(brokerUrl(endpoint({ protocol: 'ws', path: 'mqtt' }))).toBe(
      'ws://broker.local:1883/mqtt'
    )
  })

  it('omits an empty WebSocket path', () => {
    expect(brokerUrl(endpoint({ protocol: 'wss', path: '' }))).toBe('wss://broker.local:1883')
  })

  it('keeps nested paths and query strings', () => {
    expect(brokerUrl(endpoint({ protocol: 'wss', path: '/ws/mqtt?token=1' }))).toBe(
      'wss://broker.local:1883/ws/mqtt?token=1'
    )
  })

  it('brackets IPv6 hosts exactly once', () => {
    expect(brokerUrl(endpoint({ host: '::1' }))).toBe('mqtt://[::1]:1883')
    expect(brokerUrl(endpoint({ host: '2001:db8::1', protocol: 'ws' }))).toBe(
      'ws://[2001:db8::1]:1883/mqtt'
    )
    expect(brokerUrl(endpoint({ host: '[::1]' }))).toBe('mqtt://[::1]:1883')
  })

  it('does not bracket IPv4 addresses or host names', () => {
    expect(brokerUrl(endpoint({ host: '127.0.0.1' }))).toBe('mqtt://127.0.0.1:1883')
  })
})

describe('createSubscription', () => {
  it('fills defaults', () => {
    const before = Date.now()
    const sub = createSubscription()
    expect(sub).toMatchObject({
      topic: '#',
      qos: 0,
      alias: '',
      enabled: true,
      noLocal: false,
      // On, so live retained publishes keep their RETAIN flag (ignored on MQTT 3.x).
      retainAsPublished: true,
      retainHandling: 0
    })
    expect(sub.subscriptionIdentifier).toBeUndefined()
    expect(sub.id).toMatch(UUID_V4)
    expect(PALETTE).toContain(sub.color)
    expect(sub.createdAt).toBeGreaterThanOrEqual(before)
    expect(sub.createdAt).toBeLessThanOrEqual(Date.now())
  })

  it('applies overrides', () => {
    const sub = createSubscription({ id: 's1', topic: 'a/+', qos: 2, color: '#000000', alias: 'A' })
    expect(sub).toMatchObject({ id: 's1', topic: 'a/+', qos: 2, color: '#000000', alias: 'A' })
    expect(createSubscription({ subscriptionIdentifier: 3 }).subscriptionIdentifier).toBe(3)
  })

  it('creates unique ids', () => {
    expect(createSubscription().id).not.toBe(createSubscription().id)
  })
})

describe('createConnectionProfile', () => {
  it('fills sensible defaults', () => {
    const profile = createConnectionProfile()
    expect(profile).toMatchObject({
      name: 'New connection',
      group: '',
      protocol: 'mqtt',
      host: 'localhost',
      port: DEFAULT_PORTS.mqtt,
      path: '/mqtt',
      username: '',
      password: '',
      protocolVersion: 5,
      clean: true,
      keepalive: 60,
      connectTimeout: 10_000,
      autoReconnect: true,
      reconnectPeriod: 4_000,
      subscriptions: []
    })
    expect(profile.id).toMatch(UUID_V4)
    expect(profile.clientId).toMatch(CLIENT_ID)
    expect(PALETTE).toContain(profile.color)
    expect(profile.tls).toEqual({
      rejectUnauthorized: true,
      caPath: '',
      certPath: '',
      keyPath: '',
      passphrase: '',
      servername: '',
      alpnProtocols: []
    })
    expect(profile.will).toEqual({
      enabled: false,
      topic: '',
      payload: '',
      qos: 0,
      retain: false,
      properties: { userProperties: [] }
    })
    expect(profile.properties).toEqual({ userProperties: [] })
    expect(profile.createdAt).toBe(profile.updatedAt)
    expect(profile.lastConnectedAt).toBeUndefined()
  })

  it('applies overrides shallowly', () => {
    const tls = { ...createConnectionProfile().tls, rejectUnauthorized: false }
    const profile = createConnectionProfile({ name: 'Prod', host: 'h', port: 1, tls })
    expect(profile).toMatchObject({ name: 'Prod', host: 'h', port: 1 })
    expect(profile.tls).toBe(tls)
  })

  it('keeps the mqtt default port when only the protocol is overridden (debatable)', () => {
    expect(createConnectionProfile({ protocol: 'wss' }).port).toBe(DEFAULT_PORTS.mqtt)
  })

  it('never shares nested objects between profiles', () => {
    const a = createConnectionProfile()
    const b = createConnectionProfile()
    a.tls.alpnProtocols.push('h2')
    a.properties.userProperties.push({ key: 'k', value: 'v' })
    a.will.properties.userProperties.push({ key: 'k', value: 'v' })
    a.subscriptions.push(createSubscription())
    expect(b.tls.alpnProtocols).toEqual([])
    expect(b.properties.userProperties).toEqual([])
    expect(b.will.properties.userProperties).toEqual([])
    expect(b.subscriptions).toEqual([])
  })

  it('is structured-clone friendly (travels over IPC)', () => {
    const profile = createConnectionProfile({ subscriptions: [createSubscription()] })
    expect(structuredClone(profile)).toEqual(profile)
  })
})
