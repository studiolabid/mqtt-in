import { describe, expect, it } from 'vitest'
import { createConnectionProfile } from '@shared/defaults'
import {
  parseConnectionProfile,
  parseExportOptions,
  parseExternalUrl,
  parseId,
  parseIds,
  parseOptionalIds,
  parsePickFileOptions,
  parsePublishRequest,
  parseRepeatOptions,
  parseSaveFileOptions,
  parseSettingsPatch,
  parseStorageKey,
  parseSubscription,
  parseThemeMode
} from '../../../src/main/ipc/validate'

const bytes = new Uint8Array([1, 2, 3])

describe('IPC validation', () => {
  it('validates ids', () => {
    expect(parseId('abc')).toBe('abc')
    expect(() => parseId('')).toThrow(/Invalid id/)
    expect(() => parseId(42, 'connection id')).toThrow(/Invalid connection id/)
    expect(parseIds(['a', 'b'])).toEqual(['a', 'b'])
    expect(parseOptionalIds(undefined)).toBeUndefined()
    expect(parseOptionalIds(null)).toBeUndefined()
    expect(() => parseIds('a')).toThrow(/id list/)
  })

  it('validates publish requests', () => {
    expect(parsePublishRequest({ topic: 'a/b', payload: bytes, qos: 1, retain: true })).toEqual({
      topic: 'a/b',
      payload: bytes,
      qos: 1,
      retain: true
    })
    expect(() =>
      parsePublishRequest({ topic: 'a/#', payload: bytes, qos: 0, retain: false })
    ).toThrow('Invalid publish request: topic: Wildcards (+, #) are not allowed when publishing')
    expect(() => parsePublishRequest({ topic: 'a', payload: [1], qos: 0, retain: false })).toThrow(
      /Payload must be bytes/
    )
    expect(() =>
      parsePublishRequest({ topic: 'a', payload: bytes, qos: 3, retain: false })
    ).toThrow(/QoS must be 0, 1 or 2/)
  })

  it('cleans publish properties (null = unset, unknown keys stripped)', () => {
    const request = parsePublishRequest({
      topic: 't',
      payload: bytes,
      qos: 0,
      retain: false,
      properties: {
        messageExpiryInterval: null,
        contentType: 'text/plain',
        subscriptionIdentifier: [1],
        userProperties: [{ key: 'k', value: 'v', extra: true }]
      }
    })
    expect(request.properties).toEqual({
      contentType: 'text/plain',
      userProperties: [{ key: 'k', value: 'v' }]
    })
    expect(() =>
      parsePublishRequest({
        topic: 't',
        payload: bytes,
        qos: 0,
        retain: false,
        properties: { responseTopic: 'reply/+' }
      })
    ).toThrow(/Response topic/)
  })

  it('validates repeat options and their payload', () => {
    const base = {
      topic: 't',
      payload: '{"n": {{counter}}}',
      format: 'json',
      qos: 0,
      retain: false,
      intervalMs: 12.6,
      count: 0
    }
    expect(parseRepeatOptions(base).intervalMs).toBe(13)
    expect(() => parseRepeatOptions({ ...base, intervalMs: 5 })).toThrow(/at least 10 ms/)
    expect(() => parseRepeatOptions({ ...base, count: -1 })).toThrow(/count/)
    expect(() => parseRepeatOptions({ ...base, format: 'xml' })).toThrow(/format/)
    expect(() => parseRepeatOptions({ ...base, payload: '{"n": ' })).toThrow(
      /^Invalid repeat payload: Invalid JSON/
    )
    // useTemplate is optional (rendering stays the default) and must be a boolean.
    expect(parseRepeatOptions(base)).not.toHaveProperty('useTemplate')
    expect(() => parseRepeatOptions({ ...base, useTemplate: 'no' })).toThrow(/useTemplate/)
    // Without rendering, the literal `{{counter}}` is not valid JSON.
    expect(() => parseRepeatOptions({ ...base, useTemplate: false })).toThrow(
      /^Invalid repeat payload: Invalid JSON/
    )
    expect(
      parseRepeatOptions({ ...base, format: 'text', payload: '{{x}}', useTemplate: false })
    ).toMatchObject({ payload: '{{x}}', useTemplate: false })
  })

  it('validates settings patches', () => {
    expect(parseSettingsPatch({ theme: 'dark', maxMessagesPerConnection: 5 })).toEqual({
      theme: 'dark',
      maxMessagesPerConnection: 100
    })
    expect(parseSettingsPatch({ maxMessagesPerConnection: 1e9 }).maxMessagesPerConnection).toBe(
      200_000
    )
    expect(() => parseSettingsPatch({ theme: 'purple' })).toThrow(/Invalid settings: theme/)
    expect(() => parseSettingsPatch({ fontSize: 3 })).toThrow(/Unrecognized key/)
    expect(() => parseSettingsPatch('dark')).toThrow(/Invalid settings/)
  })

  it('validates storage keys, theme modes and external URLs', () => {
    expect(parseStorageKey('publish.history:v1')).toBe('publish.history:v1')
    expect(() => parseStorageKey('a b')).toThrow(/storage key/)
    expect(() => parseStorageKey('x'.repeat(129))).toThrow(/storage key/)
    expect(() => parseStorageKey('__proto__')).toThrow(/Reserved/)
    expect(parseThemeMode('system')).toBe('system')
    expect(() => parseThemeMode('auto')).toThrow(/theme/)
    expect(parseExternalUrl('https://mqtt.org')).toBe('https://mqtt.org/')
    expect(parseExternalUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com')
    expect(() => parseExternalUrl('javascript:alert(1)')).toThrow(/Only http, https and mailto/)
    expect(() => parseExternalUrl('file:///etc/passwd')).toThrow(/Only http/)
    expect(() => parseExternalUrl('not a url')).toThrow('Invalid URL')
  })

  it('validates and normalizes connection profiles', () => {
    const profile = createConnectionProfile({ name: 'Broker' })
    const parsed = parseConnectionProfile({
      ...profile,
      injected: '<script>',
      tls: { caPath: '/ca' }
    })
    expect(parsed).not.toHaveProperty('injected')
    expect(parsed.id).toBe(profile.id)
    expect(parsed.tls).toMatchObject({ caPath: '/ca', rejectUnauthorized: true, alpnProtocols: [] })
    expect(() => parseConnectionProfile({ ...profile, port: 70000 })).toThrow(
      'Invalid connection profile: port: Port must be 1-65535'
    )
    expect(() => parseConnectionProfile({ ...profile, protocol: 'tcp' })).toThrow(/protocol/)
    expect(() => parseConnectionProfile(null)).toThrow(/Invalid connection profile/)
  })

  it('validates export options strictly', () => {
    expect(parseExportOptions(undefined)).toEqual({})
    expect(parseExportOptions(null)).toEqual({})
    expect(parseExportOptions({})).toEqual({})
    expect(parseExportOptions({ includeSecrets: true })).toEqual({ includeSecrets: true })
    expect(() => parseExportOptions({ includeSecrets: 'yes' })).toThrow(
      /^Invalid export options: includeSecrets/
    )
    expect(() => parseExportOptions({ includeSecrets: 1 })).toThrow(/^Invalid export options/)
    expect(() => parseExportOptions({ includeSecrets: false, plainText: true })).toThrow(
      /^Invalid export options: Unrecognized key/
    )
    expect(() => parseExportOptions('all')).toThrow(/^Invalid export options/)
  })

  it('limits MQTT strings to 65535 UTF-8 bytes, not characters', () => {
    const fits = '€'.repeat(21_845) // 65,535 bytes
    const over = '€'.repeat(21_846) // 65,538 bytes, but only 21,846 characters
    const publish = (properties: object): unknown =>
      parsePublishRequest({ topic: 't', payload: bytes, qos: 0, retain: false, properties })

    expect(publish({ contentType: fits })).toMatchObject({ properties: { contentType: fits } })
    expect(() => publish({ contentType: over })).toThrow(
      'Invalid publish request: properties.contentType: Content type is too long (max 65535 bytes)'
    )
    const value = (text: string): unknown =>
      publish({ userProperties: [{ key: 'k', value: text }] })
    expect(value(fits)).toMatchObject({ properties: { userProperties: [{ value: fits }] } })
    expect(() => value(over)).toThrow(
      'properties.userProperties.0.value: User property value is too long (max 65535 bytes)'
    )
    expect(() => publish({ correlationData: over })).toThrow(/Correlation data is too long/)
    expect(() => publish({ responseTopic: `r/${over}` })).toThrow(/Response topic/)
    expect(() => publish({ contentType: 'a\uD800b' })).toThrow(
      /Content type contains an unpaired surrogate/
    )

    const profile = createConnectionProfile({ name: 'Broker' })
    expect(parseConnectionProfile({ ...profile, clientId: fits }).clientId).toBe(fits)
    expect(() => parseConnectionProfile({ ...profile, clientId: over })).toThrow(
      'Invalid connection profile: clientId: Client ID is too long (max 65535 bytes)'
    )
    for (const [patch, message] of [
      [{ username: over }, 'username: Username is too long'],
      [{ password: over }, 'password: Password is too long'],
      [
        { properties: { userProperties: [{ key: over, value: 'v' }] } },
        'properties.userProperties.0.key: User property key is too long'
      ],
      [
        { will: { ...profile.will, properties: { contentType: over, userProperties: [] } } },
        'will.properties.contentType: Will content type is too long'
      ],
      [{ will: { ...profile.will, payload: over } }, 'will.payload: Will payload is too long'],
      [{ subscriptions: [{ topic: over }] }, 'subscriptions.0.topic: Topic filter is too long']
    ] as const) {
      expect(() => parseConnectionProfile({ ...profile, ...patch })).toThrow(message)
    }
  })

  it('applies the rules of the connection form to profiles', () => {
    const profile = createConnectionProfile({ name: 'Broker' })
    for (const host of ['u:p@h', 'bob:pw@127.0.0.1', 'mqtt://broker.local', 'broker.local:1883']) {
      expect(() => parseConnectionProfile({ ...profile, host })).toThrow(
        'Invalid connection profile: host: Enter only the host name (no mqtt://, path, port or credentials)'
      )
    }
    expect(() => parseConnectionProfile({ ...profile, host: '' })).toThrow('host: Host is required')
    expect(parseConnectionProfile({ ...profile, host: '  broker.local ' }).host).toBe(
      'broker.local'
    )
    expect(parseConnectionProfile({ ...profile, host: '::1' }).host).toBe('::1')

    expect(() =>
      parseConnectionProfile({ ...profile, autoReconnect: true, reconnectPeriod: 1 })
    ).toThrow(
      'Invalid connection profile: reconnectPeriod: Reconnect period must be at least 100 ms with auto reconnect on'
    )
    expect(
      parseConnectionProfile({ ...profile, autoReconnect: true, reconnectPeriod: 100 })
    ).toMatchObject({ reconnectPeriod: 100 })
    // Auto reconnect off: the period is not used.
    expect(
      parseConnectionProfile({ ...profile, autoReconnect: false, reconnectPeriod: 1 })
    ).toMatchObject({ reconnectPeriod: 1 })

    const will = (patch: object): unknown =>
      parseConnectionProfile({ ...profile, will: { ...profile.will, ...patch } })
    expect(() => will({ enabled: true, topic: '' })).toThrow('will.topic: Topic is required')
    expect(() => will({ enabled: true, topic: 'status/#' })).toThrow(/will.topic: Wildcards/)
    expect(will({ enabled: false, topic: 'status/#' })).toMatchObject({ will: { enabled: false } })
  })

  it('validates live subscriptions', () => {
    const sub = parseSubscription({ id: 's1', topic: '$share/g/a/+', qos: 2 })
    expect(sub).toMatchObject({
      id: 's1',
      topic: '$share/g/a/+',
      qos: 2,
      enabled: true,
      noLocal: false
    })
    expect(() => parseSubscription({ id: 's1', topic: 'a/#/b' })).toThrow(/'#' must be the last/)
    expect(() => parseSubscription({ topic: 'a' })).toThrow(/Invalid subscription: id/)
  })

  it('validates file dialog options', () => {
    expect(parsePickFileOptions(undefined)).toEqual({})
    expect(
      parsePickFileOptions({ filters: [{ name: 'PEM', extensions: ['pem', 'crt'] }] })
    ).toEqual({ filters: [{ name: 'PEM', extensions: ['pem', 'crt'] }] })
    expect(() => parsePickFileOptions({ filters: [{ name: 'x', extensions: ['../..'] }] })).toThrow(
      /Invalid file extension/
    )
    expect(parseSaveFileOptions({ content: 'text', defaultPath: 'a.json' }).content).toBe('text')
    expect(parseSaveFileOptions({ content: bytes }).content).toBe(bytes)
    expect(() => parseSaveFileOptions({ content: 5 })).toThrow(/Content must be a string or bytes/)
  })
})
