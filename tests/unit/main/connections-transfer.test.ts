import { describe, expect, it } from 'vitest'
import { createConnectionProfile, createSubscription, isGeneratedClientId } from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import { planImport } from '../../../src/main/services/storage/connections-import'
import {
  buildExport,
  connectionIdentity,
  isImportableFilePath,
  MAX_IMPORT_ENTRIES,
  readImportFile,
  UniqueNames,
  withImportableTlsPaths
} from '../../../src/main/services/storage/connections-transfer'
import { fromMqttx, isMqttxEntry } from '../../../src/main/services/storage/import-mqttx'

function secretProfile(name: string): ConnectionProfile {
  const base = createConnectionProfile({ name, password: `pw-${name}` })
  return { ...base, tls: { ...base.tls, passphrase: `key-${name}` } }
}

/** An MQTTX "Export data" entry (MQTTX 1.x `ConnectionModel`). */
const MQTTX_ENTRY = {
  id: '6b8e0d4c-5f1e-4c55-9a53-1c0f4b0d7b10',
  clientId: 'mqttx_4f9d1a2b',
  name: 'Plant broker',
  clean: true,
  protocol: 'mqtt',
  host: 'broker.plant.local',
  port: 8883,
  keepalive: 60,
  connectTimeout: 10,
  reconnect: true,
  reconnectPeriod: 4000,
  username: 'ops',
  password: 's3cret',
  path: '/mqtt',
  certType: 'self',
  ssl: true,
  mqttVersion: '3.1.1',
  rejectUnauthorized: false,
  ca: 'C:\\certs\\plant-ca.pem',
  cert: '',
  key: '',
  subscriptions: [
    {
      topic: 'plant/#',
      qos: 1,
      disabled: false,
      alias: 'Plant',
      color: '#34c388',
      createAt: '2024-05-01 10:00:00',
      nl: true,
      rap: false,
      rh: 2
    }
  ],
  will: {
    lastWillTopic: 'plant/status',
    lastWillPayload: 'offline',
    lastWillQos: 1,
    lastWillRetain: true,
    properties: {
      willDelayInterval: 5,
      messageExpiryInterval: null,
      contentType: 'text/plain',
      responseTopic: '',
      correlationData: null,
      userProperties: { site: 'north' }
    }
  },
  properties: {
    sessionExpiryInterval: 3600,
    receiveMaximum: null,
    requestProblemInformation: true,
    userProperties: { app: ['mqttx', 'x2'] }
  },
  messages: [{ out: true, topic: 'plant/x', payload: 'hello' }],
  unreadMessageCount: 0,
  orderId: 1,
  createAt: '2024-05-01 10:00:00'
}

const context = { existing: [], openSecrets: (entry: unknown) => entry, now: 1_234 }

describe('buildExport', () => {
  it('leaves passwords and TLS passphrases out unless includeSecrets is set', () => {
    const profiles = [secretProfile('a'), secretProfile('b')]
    for (const options of [undefined, {}, { includeSecrets: false }]) {
      const text = buildExport(profiles, options)
      expect(text).not.toMatch(/pw-|key-/)
      const file = JSON.parse(text) as { connections: ConnectionProfile[] }
      expect(file.connections.map((p) => [p.password, p.tls.passphrase])).toEqual([
        ['', ''],
        ['', '']
      ])
    }
    const withSecrets = JSON.parse(buildExport(profiles, { includeSecrets: true })) as {
      connections: ConnectionProfile[]
    }
    expect(withSecrets.connections.map((p) => [p.password, p.tls.passphrase])).toEqual([
      ['pw-a', 'key-a'],
      ['pw-b', 'key-b']
    ])
    // The profiles themselves are not changed.
    expect(profiles[0].password).toBe('pw-a')
  })

  it('writes the mqtt-in file header without machine-specific fields', () => {
    const profile = { ...secretProfile('a'), lastConnectedAt: 5 }
    const file = JSON.parse(buildExport([profile], { now: new Date(0) }))
    expect(file).toMatchObject({
      app: 'mqtt-in',
      version: 1,
      exportedAt: '1970-01-01T00:00:00.000Z'
    })
    expect(file.connections[0]).not.toHaveProperty('lastConnectedAt')
  })
})

describe('TLS paths of imported profiles', () => {
  it('keeps only absolute paths on a local drive', () => {
    for (const path of ['C:/certs/ca.pem', 'C:\\certs\\ca.pem', 'd:\\x.pem', '/etc/ssl/ca.pem']) {
      expect(isImportableFilePath(path), path).toBe(true)
    }
    for (const path of [
      '\\\\192.0.2.1\\share\\ca.pem',
      '//attacker.example/share/ca.pem',
      '/\\host\\share\\ca.pem',
      '\\\\?\\C:\\certs\\ca.pem',
      '\\\\.\\pipe\\x',
      'certs/ca.pem',
      './ca.pem',
      'C:certs\\ca.pem',
      '\\certs\\ca.pem',
      '~/ca.pem'
    ]) {
      expect(isImportableFilePath(path), path).toBe(false)
    }
  })

  it('clears the paths it refuses, and the passphrase with a cleared key', () => {
    const tls = createConnectionProfile().tls
    const kept = { ...tls, caPath: 'C:/certs/ca.pem', keyPath: '/etc/ssl/key.pem', passphrase: 'p' }
    expect(withImportableTlsPaths(kept)).toEqual({ tls: kept, cleared: false })

    const unc = { ...kept, caPath: '\\\\192.0.2.1\\share\\ca.pem' }
    expect(withImportableTlsPaths(unc)).toEqual({
      tls: { ...kept, caPath: '' },
      cleared: true
    })
    const device = { ...kept, certPath: 'cert.pem', keyPath: '\\\\?\\C:\\key.pem' }
    expect(withImportableTlsPaths(device)).toEqual({
      tls: { ...kept, certPath: '', keyPath: '', passphrase: '' },
      cleared: true
    })
  })
})

describe('import file shapes', () => {
  it(`accepts at most ${MAX_IMPORT_ENTRIES} entries`, () => {
    const entries = (n: number): unknown[] => Array.from({ length: n }, () => ({ host: 'h' }))
    expect(readImportFile(entries(1_000)).candidates).toHaveLength(1_000)
    expect(() => readImportFile(entries(1_001))).toThrow(
      'The file has 1,001 connections; at most 1,000 can be imported at once'
    )
    expect(() => readImportFile({ connections: entries(6_000) })).toThrow(
      'The file has 6,000 connections; at most 1,000 can be imported at once'
    )
  })

  it('names the format: mqtt-in file, single profile or MQTTX export', () => {
    expect(readImportFile({ app: 'mqtt-in', connections: [] }).source).toBe('mqtt-in')
    expect(readImportFile([{ host: 'h' }]).source).toBe('mqtt-in')
    expect(readImportFile({ name: 'One', host: 'h' }).source).toBe('profile')
    expect(readImportFile([MQTTX_ENTRY]).source).toBe('mqttx')
    expect(readImportFile(MQTTX_ENTRY).source).toBe('mqttx')
  })

  it('refuses JSON that is no connections file', () => {
    for (const data of [
      { name: 'mqtt-in', version: '1.0.0', dependencies: {} },
      {},
      42,
      'x',
      null
    ]) {
      expect(() => readImportFile(data)).toThrow(
        'Unrecognized file: expected an mqtt-in or MQTTX connections export, or a single connection'
      )
    }
    expect(() => readImportFile({ connections: 'nope' })).toThrow(/"connections" must be a list/)
  })

  it('takes the connections out of MQTTX collections, with the collection as group', () => {
    const tree = [{ id: 'c', name: 'Plant', isCollection: true, children: [MQTTX_ENTRY] }]
    const [entry] = readImportFile(tree).candidates
    expect(fromMqttx(entry as Record<string, unknown>)).toMatchObject({ group: 'Plant' })
  })
})

describe('MQTTX connections', () => {
  it('are recognized by their own keys only', () => {
    expect(isMqttxEntry(MQTTX_ENTRY)).toBe(true)
    expect(isMqttxEntry({ host: 'h', will: { lastWillTopic: 't' } })).toBe(true)
    expect(isMqttxEntry(createConnectionProfile())).toBe(false)
  })

  it('map to mqtt-in profiles (units, version, TLS, Last Will, options)', () => {
    const { imported, skipped } = planImport([MQTTX_ENTRY], context)
    expect(skipped).toEqual([])
    const [profile] = imported
    expect(profile).toMatchObject({
      name: 'Plant broker',
      protocol: 'mqtts',
      host: 'broker.plant.local',
      port: 8883,
      protocolVersion: 4,
      connectTimeout: 10_000,
      keepalive: 60,
      autoReconnect: true,
      reconnectPeriod: 4000,
      username: 'ops',
      password: 's3cret',
      tls: { rejectUnauthorized: false, caPath: 'C:\\certs\\plant-ca.pem', certPath: '' },
      will: {
        enabled: true,
        topic: 'plant/status',
        payload: 'offline',
        qos: 1,
        retain: true,
        properties: {
          willDelayInterval: 5,
          contentType: 'text/plain',
          userProperties: [{ key: 'site', value: 'north' }]
        }
      },
      properties: {
        sessionExpiryInterval: 3600,
        requestProblemInformation: true,
        userProperties: [
          { key: 'app', value: 'mqttx' },
          { key: 'app', value: 'x2' }
        ]
      }
    })
    expect(profile.subscriptions).toMatchObject([
      {
        topic: 'plant/#',
        qos: 1,
        enabled: true,
        alias: 'Plant',
        noLocal: true,
        retainAsPublished: false,
        retainHandling: 2
      }
    ])
    // MQTTX's generated id is replaced (MQTTX may still be connected with it).
    expect(isGeneratedClientId(profile.clientId)).toBe(true)
  })

  it('map WebSockets and plain connections, and keep a custom client id', () => {
    const ws = {
      ...MQTTX_ENTRY,
      protocol: 'ws',
      ssl: false,
      clientId: 'plant-gw-1',
      will: undefined
    }
    expect(fromMqttx(ws)).toMatchObject({ protocol: 'ws', clientId: 'plant-gw-1' })
    expect(fromMqttx({ ...ws, ssl: true })).toMatchObject({ protocol: 'wss' })
    expect(fromMqttx({ ...ws, protocol: 'mqtt' })).toMatchObject({ protocol: 'mqtt' })
    // 'server': a CA-signed broker certificate, MQTTX ignores the files.
    expect(fromMqttx({ ...MQTTX_ENTRY, certType: 'server' }).tls).toEqual({
      rejectUnauthorized: false
    })
  })
})

describe('UniqueNames', () => {
  it('appends (imported), (imported 2)… and resumes per name', () => {
    const names = new UniqueNames(['Local', 'local (imported)', 'Other'])
    expect(names.take('Lab')).toBe('Lab')
    expect(names.take('Lab')).toBe('Lab (imported)')
    expect(names.take('Local')).toBe('Local (imported 2)')
    expect(names.take('LOCAL')).toBe('LOCAL (imported 3)')
    expect(names.take('Other')).toBe('Other (imported)')
  })

  it('costs O(n) for n clashes (counting up from 2 each time was quadratic)', () => {
    const names = new UniqueNames([])
    const started = performance.now()
    for (let i = 0; i < 20_000; i++) names.take('Broker')
    expect(names.take('Broker')).toBe('Broker (imported 20000)')
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('connectionIdentity', () => {
  const base = createConnectionProfile({ host: 'Broker.Local', clientId: 'plant-gw-1' })

  it('ignores the host case, the name, secrets and the path of non-WebSocket connections', () => {
    const same = { ...base, host: 'broker.local ', name: 'Other', password: 'x', path: '/other' }
    expect(connectionIdentity(same)).toBe(connectionIdentity(base))
  })

  it('tells protocol, port, user, client id and the WebSocket path apart', () => {
    for (const other of [
      { ...base, protocol: 'mqtts' as const },
      { ...base, port: 1884 },
      { ...base, username: 'ops' },
      { ...base, clientId: 'plant-gw-2' }
    ]) {
      expect(connectionIdentity(other)).not.toBe(connectionIdentity(base))
    }
    const ws = { ...base, protocol: 'ws' as const, path: '/mqtt' }
    expect(connectionIdentity({ ...ws, path: 'mqtt' })).toBe(connectionIdentity(ws))
    expect(connectionIdentity({ ...ws, path: '/ws' })).not.toBe(connectionIdentity(ws))
  })

  it('uses the name when the client id is empty (a new id on every connect)', () => {
    const random = { ...base, clientId: '', name: 'Sensors' }
    expect(connectionIdentity({ ...random, name: ' sensors' })).toBe(connectionIdentity(random))
    expect(connectionIdentity({ ...random, name: 'Commands' })).not.toBe(connectionIdentity(random))
  })

  it('compares subscriptions not at all', () => {
    const subscribed = { ...base, subscriptions: [createSubscription({ topic: 'a/#' })] }
    expect(connectionIdentity(subscribed)).toBe(connectionIdentity(base))
  })
})
