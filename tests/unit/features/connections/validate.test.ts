import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@shared/models'
import { createConnectionProfile } from '@shared/defaults'
import {
  countErrorsBySection,
  firstInvalidSection,
  persistentSessionHint,
  validateConnection
} from '@/features/connections/utils/validate'
import { safeParseConnectionProfile } from '../../../../src/main/schemas/profile'

type Patch = (profile: ConnectionProfile) => void

function profile(patch?: Patch): ConnectionProfile {
  const base = createConnectionProfile({ name: 'Lab', host: 'broker.local', port: 1883 })
  patch?.(base)
  return base
}

const EURO_FIT = '€'.repeat(21_845) // 65,535 bytes
const EURO_OVER = '€'.repeat(21_846) // 65,538 bytes in only 21,846 characters

/**
 * Boundary values with the same verdict in the form and in the main-process schema (strict mode,
 * the one saves go through): SEC-11, SEC-03, MS-09.
 */
const PARITY: ReadonlyArray<[string, Patch, boolean]> = [
  [
    'reconnect period 99 ms',
    (p) => Object.assign(p, { autoReconnect: true, reconnectPeriod: 99 }),
    false
  ],
  [
    'reconnect period 100 ms',
    (p) => Object.assign(p, { autoReconnect: true, reconnectPeriod: 100 }),
    true
  ],
  [
    'reconnect period 1 ms without auto reconnect',
    (p) => Object.assign(p, { autoReconnect: false, reconnectPeriod: 1 }),
    true
  ],
  ['reconnect period above a day', (p) => Object.assign(p, { reconnectPeriod: 86_400_001 }), false],
  ['host with credentials u:p@h', (p) => (p.host = 'u:p@h'), false],
  ['host with a scheme', (p) => (p.host = 'mqtt://broker.local'), false],
  ['host with a port', (p) => (p.host = 'broker.local:1883'), false],
  ['bracketed IPv6 host', (p) => (p.host = '[::1]'), false],
  ['IPv6 host', (p) => (p.host = '::1'), true],
  ['IPv4 host', (p) => (p.host = '192.168.1.20'), true],
  ['invalid IPv4 host', (p) => (p.host = '256.1.1.1'), false],
  ['client id of 65,535 bytes', (p) => (p.clientId = EURO_FIT), true],
  ['client id of 65,538 bytes', (p) => (p.clientId = EURO_OVER), false],
  ['client id with an unpaired surrogate', (p) => (p.clientId = 'a\uD800b'), false],
  ['username of 65,538 bytes', (p) => (p.username = EURO_OVER), false],
  ['password of 65,535 bytes', (p) => (p.password = EURO_FIT), true],
  ['password of 65,538 bytes', (p) => (p.password = EURO_OVER), false],
  ['keep alive 65,535 s', (p) => (p.keepalive = 65_535), true],
  ['keep alive 65,536 s', (p) => (p.keepalive = 65_536), false],
  ['connect timeout one hour', (p) => (p.connectTimeout = 3_600_000), true],
  ['connect timeout above an hour', (p) => (p.connectTimeout = 3_600_001), false],
  [
    'will topic with a wildcard',
    (p) => Object.assign(p.will, { enabled: true, topic: 'a/+' }),
    false
  ],
  ['will topic', (p) => Object.assign(p.will, { enabled: true, topic: 'devices/1/status' }), true],
  [
    'will topic with an unpaired surrogate',
    (p) => Object.assign(p.will, { enabled: true, topic: 'devices/\uD800' }),
    false
  ],
  [
    'will topic with an emoji',
    (p) => Object.assign(p.will, { enabled: true, topic: 'd/😀' }),
    true
  ],
  [
    'will response topic with an unpaired surrogate',
    (p) => (p.will.properties.responseTopic = 'reply/\uDFFF'),
    false
  ],
  [
    'user property value with an unpaired surrogate',
    (p) => (p.properties.userProperties = [{ key: 'k', value: 'v\uD83D' }]),
    false
  ],
  ['will content type of 65,538 bytes', (p) => (p.will.properties.contentType = EURO_OVER), false],
  [
    'will correlation data of 65,538 bytes',
    (p) => (p.will.properties.correlationData = EURO_OVER),
    false
  ],
  [
    'user property key of 65,538 bytes',
    (p) => (p.properties.userProperties = [{ key: EURO_OVER, value: 'v' }]),
    false
  ],
  [
    'user property value of 65,535 bytes',
    (p) => (p.properties.userProperties = [{ key: 'k', value: EURO_FIT }]),
    true
  ]
]

describe('connection form validation: parity with the main process (FA-13)', () => {
  it.each(PARITY)('%s', (_name, patch, valid) => {
    const draft = profile(patch)
    const formErrors = validateConnection(draft)
    const main = safeParseConnectionProfile(structuredClone(draft), 'strict')
    expect(Object.keys(formErrors).length === 0, JSON.stringify(formErrors)).toBe(valid)
    expect(main.ok, main.ok ? 'accepted' : main.error).toBe(valid)
  })
})

describe('connection form validation messages', () => {
  it('accepts the default profile', () => {
    expect(validateConnection(profile())).toEqual({})
  })

  it('counts MQTT strings in UTF-8 bytes', () => {
    expect(validateConnection(profile((p) => (p.clientId = EURO_OVER))).clientId).toBe(
      'Client ID is too long (max 65535 bytes)'
    )
    expect(validateConnection(profile((p) => (p.username = EURO_OVER))).username).toBe(
      'Username is too long (max 65535 bytes)'
    )
    expect(validateConnection(profile((p) => (p.password = EURO_OVER))).password).toBe(
      'Password is too long (max 65535 bytes)'
    )
    expect(validateConnection(profile((p) => (p.clientId = 'a\uD800'))).clientId).toBe(
      'Client ID contains an unpaired surrogate'
    )
  })

  it('refuses unpaired surrogates in every MQTT string the main process checks', () => {
    const lone = '\uDC00'
    const errors = validateConnection(
      profile((p) => {
        p.username = `u${lone}`
        Object.assign(p.will, { enabled: true, topic: `will/${lone}` })
        p.will.properties.contentType = `text/${lone}`
        p.will.properties.responseTopic = `reply/${lone}`
        p.will.properties.userProperties = [{ key: 'k', value: `v${lone}` }]
        p.properties.userProperties = [{ key: `k${lone}`, value: 'v' }]
      })
    )
    expect(errors).toMatchObject({
      username: 'Username contains an unpaired surrogate',
      willTopic: 'Topic contains an unpaired surrogate',
      willContentType: 'Content type contains an unpaired surrogate',
      willResponseTopic: 'Topic contains an unpaired surrogate',
      willUserProperties: 'User property 1: the value contains an unpaired surrogate',
      userProperties: 'User property 1: the key contains an unpaired surrogate'
    })
    const off = profile((p) => Object.assign(p.will, { enabled: false, topic: `will/${lone}` }))
    expect(validateConnection(off).willTopic).toBe('Will topic contains an unpaired surrogate')
  })

  it('explains host problems with the shared validator', () => {
    expect(validateConnection(profile((p) => (p.host = ''))).host).toBe('Host is required')
    expect(validateConnection(profile((p) => (p.host = 'u:p@h'))).host).toBe(
      'Enter only the host name (no mqtt://, path, port or credentials)'
    )
    expect(validateConnection(profile((p) => (p.host = '  broker.local  '))).host).toBeUndefined()
  })

  it('checks names, ports and the TLS server name', () => {
    expect(validateConnection(profile((p) => (p.name = '  '))).name).toBe('Name is required')
    expect(validateConnection(profile((p) => (p.name = 'x'.repeat(257)))).name).toMatch(/too long/)
    for (const port of [0, 65_536, 1.5, Number.NaN]) {
      expect(validateConnection(profile((p) => (p.port = port))).port).toBe(
        'Port must be between 1 and 65535'
      )
    }
    expect(
      validateConnection(profile((p) => (p.tls.servername = 'x'.repeat(256)))).servername
    ).toMatch(/max 255/)
  })

  it('states the shared limits in the messages', () => {
    expect(validateConnection(profile((p) => (p.keepalive = -1))).keepalive).toBe(
      'Keep alive must be between 0 and 65535 s'
    )
    expect(validateConnection(profile((p) => (p.connectTimeout = -1))).connectTimeout).toBe(
      'Connect timeout must be between 0 and 3600 s'
    )
    expect(validateConnection(profile((p) => (p.reconnectPeriod = 99))).reconnectPeriod).toBe(
      'Reconnect period must be between 0.1 and 86400 s'
    )
  })

  it('checks optional MQTT 5 numbers only when set', () => {
    expect(
      validateConnection(profile((p) => (p.properties.receiveMaximum = 0))).receiveMaximum
    ).toBe('Use a whole number from 1 to 65535, or leave empty')
    expect(
      validateConnection(profile((p) => (p.properties.sessionExpiryInterval = undefined)))
    ).toEqual({})
    expect(
      validateConnection(profile((p) => (p.properties.topicAliasMaximum = 65_536)))
        .topicAliasMaximum
    ).toBeDefined()
  })

  it('names the user property that is too long', () => {
    const errors = validateConnection(
      profile(
        (p) =>
          (p.properties.userProperties = [
            { key: 'a', value: 'b' },
            { key: EURO_OVER, value: '' }
          ])
      )
    )
    expect(errors.userProperties).toBe('User property 2: the key is too long (max 65535 bytes)')
  })

  it('maps errors to their sections', () => {
    const errors = validateConnection(
      profile((p) => {
        p.username = EURO_OVER
        p.properties.userProperties = [{ key: EURO_OVER, value: '' }]
      })
    )
    expect(countErrorsBySection(errors)).toMatchObject({ auth: 1, mqtt5: 1, general: 0 })
    expect(firstInvalidSection(errors)).toBe('auth')
    expect(firstInvalidSection({})).toBeNull()
  })
})

describe('persistent session hint (MQTT-07)', () => {
  it('appears only with clean start off and no client id', () => {
    expect(persistentSessionHint({ clean: false, clientId: '' })).toBe(
      'A persistent session needs a fixed client ID — one is generated when you save'
    )
    expect(persistentSessionHint({ clean: false, clientId: '   ' })).not.toBeNull()
    expect(persistentSessionHint({ clean: false, clientId: 'sensor-1' })).toBeNull()
    expect(persistentSessionHint({ clean: true, clientId: '' })).toBeNull()
  })
})
