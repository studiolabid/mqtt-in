import { describe, expect, it } from 'vitest'
import { createConnectionProfile, LIMITS } from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import { buildClientOptions } from '../../../src/main/services/mqtt/client-options'

/** No TLS file contents (the default). */
const noFiles = {}

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return createConnectionProfile({ clientId: 'client-1', ...overrides })
}

function tlsProfile(overrides: Partial<ConnectionProfile['tls']> = {}): ConnectionProfile {
  const base = profile({ protocol: 'mqtts', host: 'broker.example.com', port: 8883 })
  return { ...base, tls: { ...base.tls, ...overrides } }
}

describe('buildClientOptions', () => {
  it('maps the basic connection settings', () => {
    const { url, options, clientId } = buildClientOptions(
      profile({ keepalive: 30, connectTimeout: 5000, clean: false }),
      noFiles
    )
    expect(url).toBe('mqtt://localhost:1883')
    expect(clientId).toBe('client-1')
    expect(options).toMatchObject({
      clientId: 'client-1',
      protocolVersion: 5,
      protocolId: 'MQTT',
      clean: false,
      keepalive: 30,
      connectTimeout: 5000,
      reconnectPeriod: 4000,
      reconnectOnConnackError: true,
      resubscribe: false,
      queueQoSZero: false
    })
    expect(options).not.toHaveProperty('username')
    expect(options).not.toHaveProperty('password')
    expect(options).not.toHaveProperty('will')
    expect(options).not.toHaveProperty('properties')
    expect(options).not.toHaveProperty('ca')
    expect(options).not.toHaveProperty('rejectUnauthorized')
  })

  it('generates a client id when the profile has none', () => {
    const { options, clientId } = buildClientOptions(profile({ clientId: '  ' }), noFiles)
    expect(clientId).toMatch(/^mqtey_[0-9a-f]{8}$/)
    expect(options.clientId).toBe(clientId)
  })

  it('disables reconnects when auto-reconnect is off', () => {
    const { options } = buildClientOptions(profile({ autoReconnect: false }), noFiles)
    expect(options.reconnectPeriod).toBe(0)
    expect(options.reconnectOnConnackError).toBe(false)
  })

  it('keeps the reconnect period within LIMITS (an imported 1 ms cannot flood the broker)', () => {
    const period = (reconnectPeriod: number): number | undefined =>
      buildClientOptions(profile({ reconnectPeriod }), noFiles).options.reconnectPeriod
    expect(period(1)).toBe(LIMITS.reconnectPeriodMs.min)
    expect(period(0)).toBe(LIMITS.reconnectPeriodMs.min)
    expect(period(-50)).toBe(LIMITS.reconnectPeriodMs.min)
    expect(period(2500.4)).toBe(2500)
    expect(period(1e12)).toBe(LIMITS.reconnectPeriodMs.max)
    expect(period(Number.NaN)).toBe(4000)
    expect(
      buildClientOptions(profile({ autoReconnect: false, reconnectPeriod: 1 }), noFiles).options
        .reconnectPeriod
    ).toBe(0)
  })

  it('sends credentials only when set (a password implies an empty user name)', () => {
    expect(buildClientOptions(profile({ username: 'bob' }), noFiles).options).toMatchObject({
      username: 'bob'
    })
    expect(buildClientOptions(profile({ username: 'bob' }), noFiles).options).not.toHaveProperty(
      'password'
    )
    const { options } = buildClientOptions(profile({ password: 's3cret' }), noFiles)
    expect(options.username).toBe('')
    expect(options.password).toBe('s3cret')
  })

  it('uses the MQIsdp protocol id for MQTT 3.1', () => {
    expect(buildClientOptions(profile({ protocolVersion: 3 }), noFiles).options).toMatchObject({
      protocolVersion: 3,
      protocolId: 'MQIsdp'
    })
    expect(buildClientOptions(profile({ protocolVersion: 4 }), noFiles).options.protocolId).toBe(
      'MQTT'
    )
  })

  it('adds MQTT 5 connect properties and omits unset ones', () => {
    const base = profile()
    const { options } = buildClientOptions(
      {
        ...base,
        properties: {
          sessionExpiryInterval: 3600,
          receiveMaximum: 100,
          requestProblemInformation: true,
          userProperties: [
            { key: 'a', value: '1' },
            { key: 'a', value: '2' },
            { key: 'b', value: '3' }
          ]
        }
      },
      noFiles
    )
    expect(options.properties).toEqual({
      sessionExpiryInterval: 3600,
      receiveMaximum: 100,
      requestProblemInformation: true,
      userProperties: { a: ['1', '2'], b: '3' }
    })
  })

  it('strips every MQTT 5 property for MQTT 3.x', () => {
    const base = profile({ protocolVersion: 4 })
    const { options } = buildClientOptions(
      {
        ...base,
        properties: { sessionExpiryInterval: 60, userProperties: [{ key: 'k', value: 'v' }] },
        will: {
          enabled: true,
          topic: 'status/client-1',
          payload: 'offline',
          qos: 1,
          retain: true,
          properties: { contentType: 'text/plain', userProperties: [] }
        }
      },
      noFiles
    )
    expect(options.properties).toBeUndefined()
    expect(options.will).toEqual({
      topic: 'status/client-1',
      payload: Buffer.from('offline'),
      qos: 1,
      retain: true
    })
  })

  it('builds the last will with MQTT 5 properties', () => {
    const base = profile()
    const { options } = buildClientOptions(
      {
        ...base,
        will: {
          enabled: true,
          topic: 'status/x',
          payload: '{"online":false}',
          qos: 2,
          retain: false,
          properties: {
            willDelayInterval: 5,
            contentType: 'application/json',
            correlationData: 'abc',
            responseTopic: '',
            userProperties: [{ key: 'k', value: 'v' }]
          }
        }
      },
      noFiles
    )
    expect(options.will).toEqual({
      topic: 'status/x',
      payload: Buffer.from('{"online":false}'),
      qos: 2,
      retain: false,
      properties: {
        willDelayInterval: 5,
        contentType: 'application/json',
        correlationData: Buffer.from('abc'),
        userProperties: { k: 'v' }
      }
    })
  })

  it('omits the will when it is disabled or has no topic', () => {
    const base = profile()
    const will = { ...base.will, topic: 'a', payload: 'b' }
    expect(buildClientOptions({ ...base, will }, noFiles).options.will).toBeUndefined()
    expect(
      buildClientOptions({ ...base, will: { ...will, enabled: true, topic: '' } }, noFiles).options
        .will
    ).toBeUndefined()
  })

  it('adds the WebSocket path to ws(s) URLs only', () => {
    expect(
      buildClientOptions(profile({ protocol: 'ws', port: 8083, path: 'mqtt' }), noFiles).url
    ).toBe('ws://localhost:8083/mqtt')
    expect(buildClientOptions(profile({ path: '/mqtt' }), noFiles).url).toBe(
      'mqtt://localhost:1883'
    )
    expect(buildClientOptions(profile({ host: '::1' }), noFiles).url).toBe('mqtt://[::1]:1883')
  })

  it('uses the TLS file contents it is given and sets SNI to the host', () => {
    const material = { ca: Buffer.from('ca'), cert: Buffer.from('cert'), key: Buffer.from('key') }
    const { url, options } = buildClientOptions(
      tlsProfile({
        rejectUnauthorized: false,
        caPath: '/certs/ca.pem',
        certPath: '/certs/client.crt',
        keyPath: '/certs/client.key',
        passphrase: 'pw'
      }),
      material
    )
    expect(url).toBe('mqtts://broker.example.com:8883')
    expect(options.ca).toBe(material.ca)
    expect(options.cert).toBe(material.cert)
    expect(options.key).toBe(material.key)
    expect(options.passphrase).toBe('pw')
    expect(options.rejectUnauthorized).toBe(false)
    expect(options.servername).toBe('broker.example.com')
    expect(options).not.toHaveProperty('ALPNProtocols')
  })

  it('does no file I/O: TLS files stay out until their contents are passed', () => {
    const { options } = buildClientOptions(tlsProfile({ caPath: '/certs/ca.pem' }))
    expect(options).not.toHaveProperty('ca')
    expect(options.rejectUnauthorized).toBe(true)
  })

  it('honours a custom SNI name and ALPN protocols, and skips SNI for IP hosts', () => {
    const custom = buildClientOptions(
      tlsProfile({ servername: 'iot.example.com', alpnProtocols: [' x-amzn-mqtt-ca ', ''] }),
      noFiles
    )
    expect(custom.options.servername).toBe('iot.example.com')
    expect(custom.options.ALPNProtocols).toEqual(['x-amzn-mqtt-ca'])

    const ip = buildClientOptions({ ...tlsProfile(), host: '10.0.0.5' }, noFiles)
    expect(ip.options).not.toHaveProperty('servername')
    expect(ip.options.rejectUnauthorized).toBe(true)
  })

  it('passes SNI and ALPN overrides to the WebSocket transport for wss', () => {
    const base = tlsProfile({ servername: 'edge.example.com', alpnProtocols: ['http/1.1'] })
    const { url, options } = buildClientOptions(
      { ...base, protocol: 'wss', port: 443, path: '/mqtt' },
      noFiles
    )
    expect(url).toBe('wss://broker.example.com:443/mqtt')
    expect(options.wsOptions).toEqual({
      rejectUnauthorized: true,
      servername: 'edge.example.com',
      ALPNProtocols: ['http/1.1']
    })
  })

  it('ignores TLS settings for plain protocols', () => {
    const base = profile()
    const { options } = buildClientOptions(
      { ...base, tls: { ...base.tls, caPath: '/certs/ca.pem', passphrase: 'pw' } },
      { ca: Buffer.from('ca') }
    )
    expect(options).not.toHaveProperty('ca')
    expect(options).not.toHaveProperty('passphrase')
  })

  it('rejects an empty host', () => {
    expect(() => buildClientOptions(profile({ host: ' ' }), noFiles)).toThrow('Host is required')
  })
})
