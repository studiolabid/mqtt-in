import { describe, expect, it } from 'vitest'
import {
  createConnectionProfile,
  createSubscription,
  normalizeConnectionProfile,
  withFreshIdentity
} from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import { UUID_V4 } from './helpers'

const GENERATED_ID = /^mqttin_[0-9a-f]{8}$/

/** Simulates a profile read from disk / an import file (arbitrary JSON). */
function fromJson(json: string): Partial<ConnectionProfile> {
  return JSON.parse(json) as Partial<ConnectionProfile>
}

/** The profile without its random / time-based fields, for comparisons with the defaults. */
function stable(profile: ConnectionProfile): Partial<ConnectionProfile> {
  const copy: Partial<ConnectionProfile> = { ...profile }
  delete copy.id
  delete copy.color
  delete copy.clientId
  delete copy.createdAt
  delete copy.updatedAt
  return copy
}

const DEFAULTS = stable(createConnectionProfile())

describe('normalizeConnectionProfile', () => {
  it('fills every default for an empty object', () => {
    const profile = normalizeConnectionProfile({})
    expect(stable(profile)).toEqual(DEFAULTS)
    expect(profile.id).toMatch(UUID_V4)
  })

  it('returns an equal profile for a complete one (idempotent)', () => {
    const original = createConnectionProfile({
      name: 'Prod',
      protocol: 'wss',
      port: 8084,
      lastConnectedAt: 123,
      subscriptions: [createSubscription({ topic: 'a/#', qos: 1, subscriptionIdentifier: 4 })]
    })
    const once = normalizeConnectionProfile(original)
    expect(once).toEqual(original)
    expect(normalizeConnectionProfile(once)).toEqual(original)
  })

  it('does not mutate the input', () => {
    const input = createConnectionProfile({ subscriptions: [createSubscription()] })
    const snapshot = structuredClone(input)
    normalizeConnectionProfile(input)
    expect(input).toEqual(snapshot)
  })

  it('merges partial nested objects over the defaults', () => {
    const profile = normalizeConnectionProfile(
      fromJson(
        JSON.stringify({
          tls: { caPath: '/ca.pem' },
          will: { enabled: true, topic: 'bye', properties: { contentType: 'text/plain' } },
          properties: { sessionExpiryInterval: 60 }
        })
      )
    )
    expect(profile.tls).toEqual({ ...DEFAULTS.tls, caPath: '/ca.pem' })
    expect(profile.will).toEqual({
      enabled: true,
      topic: 'bye',
      payload: '',
      qos: 0,
      retain: false,
      properties: { contentType: 'text/plain', userProperties: [] }
    })
    expect(profile.properties).toEqual({ sessionExpiryInterval: 60, userProperties: [] })
  })

  it('keeps user properties', () => {
    const userProperties = [{ key: 'a', value: '1' }]
    const profile = normalizeConnectionProfile({
      properties: { userProperties },
      will: { ...createConnectionProfile().will, properties: { userProperties } }
    })
    expect(profile.properties.userProperties).toEqual(userProperties)
    expect(profile.will.properties.userProperties).toEqual(userProperties)
  })

  it('fills subscriptions that miss fields and keeps the ones present', () => {
    const profile = normalizeConnectionProfile(
      fromJson('{"subscriptions":[{"id":"s1","topic":"a/#","qos":2},{}]}')
    )
    expect(profile.subscriptions).toHaveLength(2)
    expect(profile.subscriptions[0]).toMatchObject({
      id: 's1',
      topic: 'a/#',
      qos: 2,
      alias: '',
      enabled: true,
      noLocal: false,
      retainAsPublished: true,
      retainHandling: 0
    })
    expect(typeof profile.subscriptions[0].color).toBe('string')
    expect(typeof profile.subscriptions[0].createdAt).toBe('number')
    expect(profile.subscriptions[1].id).toMatch(UUID_V4)
    expect(profile.subscriptions[1].topic).toBe('#')
  })

  it('never throws on null nested objects and fills their defaults', () => {
    const legacy = fromJson(
      '{"name":"Old","tls":null,"will":{"properties":null},"properties":null,"subscriptions":null}'
    )
    const profile = normalizeConnectionProfile(legacy)
    expect(profile.name).toBe('Old')
    expect(profile.tls).toEqual(DEFAULTS.tls)
    expect(profile.will).toEqual(DEFAULTS.will)
    expect(profile.properties).toEqual(DEFAULTS.properties)
    expect(profile.subscriptions).toEqual([])
  })

  it('never throws on malformed collections', () => {
    const malformed = fromJson(
      JSON.stringify({
        subscriptions: { 0: { topic: 'x' } },
        tls: { alpnProtocols: 'h2' },
        properties: { userProperties: {} },
        will: { properties: { userProperties: 'x' } }
      })
    )
    const profile = normalizeConnectionProfile(malformed)
    expect(profile.subscriptions).toEqual([])
    expect(profile.tls.alpnProtocols).toEqual([])
    expect(profile.properties.userProperties).toEqual([])
    expect(profile.will.properties.userProperties).toEqual([])
  })

  it('drops subscription entries that are not objects', () => {
    const profile = normalizeConnectionProfile(
      fromJson('{"subscriptions":[null,"x",42,[1],{"topic":"ok"}]}')
    )
    expect(profile.subscriptions.map((s) => s.topic)).toEqual(['ok'])
  })

  it('treats null fields (legacy JSON) as missing', () => {
    const profile = normalizeConnectionProfile(
      fromJson(
        JSON.stringify({
          id: null,
          name: null,
          port: null,
          lastConnectedAt: null,
          tls: { caPath: null },
          will: { topic: null },
          subscriptions: [{ topic: 'x', qos: null, alias: null }]
        })
      )
    )
    expect(profile.id).toMatch(UUID_V4)
    expect(profile.name).toBe(DEFAULTS.name)
    expect(profile.port).toBe(DEFAULTS.port)
    expect(profile.lastConnectedAt).toBeUndefined()
    expect(profile.tls.caPath).toBe('')
    expect(profile.will.topic).toBe('')
    expect(profile.subscriptions[0]).toMatchObject({ topic: 'x', qos: 0, alias: '' })
  })

  it('treats undefined fields as missing', () => {
    const profile = normalizeConnectionProfile({ id: undefined, name: undefined, port: undefined })
    expect(profile.id).toMatch(UUID_V4)
    expect(profile.name).toBe(DEFAULTS.name)
    expect(profile.port).toBe(DEFAULTS.port)
  })

  it('keeps falsy but meaningful values', () => {
    const profile = normalizeConnectionProfile({
      name: '',
      keepalive: 0,
      clean: false,
      autoReconnect: false,
      tls: { ...DEFAULTS.tls, rejectUnauthorized: false } as ConnectionProfile['tls']
    })
    expect(profile).toMatchObject({ name: '', keepalive: 0, clean: false, autoReconnect: false })
    expect(profile.tls.rejectUnauthorized).toBe(false)
  })
})

describe('normalizeConnectionProfile: client id of a persistent session', () => {
  it('generates the id once when clean start is off and the id is empty', () => {
    const profile = normalizeConnectionProfile({ clean: false, clientId: '' })
    expect(profile.clientId).toMatch(GENERATED_ID)
    // Kept on later normalizations (load, save): the broker resumes the session under it.
    expect(normalizeConnectionProfile(profile).clientId).toBe(profile.clientId)
    expect(normalizeConnectionProfile(fromJson(JSON.stringify(profile))).clientId).toBe(
      profile.clientId
    )
  })

  it('treats a blank id like an empty one', () => {
    expect(normalizeConnectionProfile({ clean: false, clientId: '   ' }).clientId).toMatch(
      GENERATED_ID
    )
  })

  it('keeps an empty id with clean start (a new id per connect is fine then)', () => {
    expect(normalizeConnectionProfile({ clean: true, clientId: '' }).clientId).toBe('')
    expect(normalizeConnectionProfile({ clientId: '' }).clientId).toBe('')
  })

  it('keeps a custom id and does not mutate the input', () => {
    expect(normalizeConnectionProfile({ clean: false, clientId: 'plant-gw-1' }).clientId).toBe(
      'plant-gw-1'
    )
    const input = { clean: false, clientId: '' }
    normalizeConnectionProfile(input)
    expect(input.clientId).toBe('')
  })
})

describe('createSubscription: Retain As Published', () => {
  it('is on by default and an explicit false is kept', () => {
    expect(createSubscription().retainAsPublished).toBe(true)
    expect(createSubscription({ retainAsPublished: false }).retainAsPublished).toBe(false)
  })

  it('keeps a stored false and fills a missing flag with the default', () => {
    const profile = normalizeConnectionProfile(
      fromJson('{"subscriptions":[{"topic":"a","retainAsPublished":false},{"topic":"b"}]}')
    )
    expect(profile.subscriptions.map((s) => s.retainAsPublished)).toEqual([false, true])
  })
})

describe('withFreshIdentity', () => {
  function source(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
    return createConnectionProfile({
      name: 'Plant',
      clientId: 'mqttin_0a1b2c3d',
      password: 'pw',
      lastConnectedAt: 5,
      createdAt: 10,
      updatedAt: 20,
      subscriptions: [createSubscription({ topic: 'a/#' }), createSubscription({ topic: 'b' })],
      ...overrides
    })
  }

  it('renews the ids, the name and the timestamps and drops lastConnectedAt', () => {
    const original = source()
    const copy = withFreshIdentity(original, { name: 'Plant (imported)', now: 1234 })
    expect(copy.id).toMatch(UUID_V4)
    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe('Plant (imported)')
    expect(copy.createdAt).toBe(1234)
    expect(copy.updatedAt).toBe(1234)
    expect(copy).not.toHaveProperty('lastConnectedAt')
    expect(copy.subscriptions.map((s) => s.topic)).toEqual(['a/#', 'b'])
    for (const [index, sub] of copy.subscriptions.entries()) {
      expect(sub.id).toMatch(UUID_V4)
      expect(sub.id).not.toBe(original.subscriptions[index].id)
    }
    expect(copy.password).toBe('pw')
  })

  it('regenerates a generated client id and keeps custom and empty ones', () => {
    const generated = withFreshIdentity(source(), { name: 'x', now: 1 }).clientId
    expect(generated).toMatch(GENERATED_ID)
    expect(generated).not.toBe('mqttin_0a1b2c3d')
    const custom = source({ clientId: 'plant-gw-1' })
    expect(withFreshIdentity(custom, { name: 'x', now: 1 }).clientId).toBe('plant-gw-1')
    expect(withFreshIdentity(source({ clientId: '' }), { name: 'x', now: 1 }).clientId).toBe('')
  })

  it('returns a deep copy and leaves the input unchanged', () => {
    const original = source()
    const snapshot = structuredClone(original)
    const copy = withFreshIdentity(original, { name: 'x', now: 1 })
    expect(original).toEqual(snapshot)
    expect(copy.tls).not.toBe(original.tls)
    expect(copy.will.properties).not.toBe(original.will.properties)
    expect(copy.subscriptions[0]).not.toBe(original.subscriptions[0])
  })

  it('copies through a proxy (Vue reactive state) into structured-clone friendly data', () => {
    const original = source()
    const proxied = new Proxy(original, {})
    expect(() => structuredClone(proxied)).toThrow()
    const copy = withFreshIdentity(proxied, { name: 'x', now: 1 })
    expect(structuredClone(copy)).toEqual(copy)
    expect(copy.subscriptions).toHaveLength(2)
  })
})
