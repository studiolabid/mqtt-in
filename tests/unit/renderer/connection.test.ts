import { describe, expect, it } from 'vitest'
import type { ConnectionProfile, ConnectionStatus } from '@shared/models'
import {
  createConnectionProfile,
  createSubscription,
  isGeneratedClientId,
  protocolLabel as sharedProtocolLabel,
  withFreshIdentity
} from '@shared/defaults'
import {
  connectionInitials,
  duplicateProfile,
  groupProfiles,
  isActiveStatus,
  isBusyStatus,
  nextConnectionName,
  profileSummary,
  protocolLabel,
  reorderIds,
  statusLabel,
  statusTone,
  uniqueName
} from '@/utils/connection'

describe('protocolLabel', () => {
  it('names every protocol version', () => {
    expect(protocolLabel(5)).toBe('MQTT 5.0')
    expect(protocolLabel(4)).toBe('MQTT 3.1.1')
    expect(protocolLabel(3)).toBe('MQTT 3.1')
  })
})

describe('profileSummary', () => {
  it('combines the broker URL and the protocol', () => {
    expect(profileSummary(createConnectionProfile())).toBe('mqtt://localhost:1883 · MQTT 5.0')
    expect(
      profileSummary(
        createConnectionProfile({
          protocol: 'wss',
          host: 'broker.example.com',
          port: 8084,
          path: 'mqtt',
          protocolVersion: 4
        })
      )
    ).toBe('wss://broker.example.com:8084/mqtt · MQTT 3.1.1')
  })
})

describe('status helpers', () => {
  const all: ConnectionStatus[] = [
    'disconnected',
    'connecting',
    'connected',
    'reconnecting',
    'disconnecting',
    'error'
  ]

  it('labels and colors every status', () => {
    expect(all.map(statusLabel)).toEqual([
      'Disconnected',
      'Connecting…',
      'Connected',
      'Reconnecting…',
      'Disconnecting…',
      'Error'
    ])
    expect(all.map(statusTone)).toEqual([
      'muted',
      'warning',
      'success',
      'warning',
      'warning',
      'destructive'
    ])
  })

  it('classifies active and busy statuses', () => {
    expect(all.filter(isActiveStatus)).toEqual(['connecting', 'connected', 'reconnecting'])
    expect(all.filter(isBusyStatus)).toEqual(['connecting', 'reconnecting', 'disconnecting'])
  })
})

describe('connectionInitials', () => {
  it.each([
    ['Home Broker', 'HB'],
    ['mosquitto', 'MO'],
    ['test.mosquitto.org', 'TM'],
    ['  aws-iot  ', 'AI'],
    ['x', 'X'],
    ['', '?'],
    ['   ', '?'],
    ['😀 Fun', '😀F']
  ])('%j → %j', (name, expected) => {
    expect(connectionInitials(name)).toBe(expected)
  })
})

describe('uniqueName / nextConnectionName / reorderIds', () => {
  it('appends the first free number (case-insensitive)', () => {
    expect(uniqueName('Broker', [])).toBe('Broker')
    expect(uniqueName('Broker', ['broker ', 'Broker 2'])).toBe('Broker 3')
  })

  it('names new connections "Connection N"', () => {
    expect(nextConnectionName([])).toBe('Connection 1')
    expect(nextConnectionName(['a', 'Connection 3'])).toBe('Connection 4')
    expect(nextConnectionName(['Connection 2'])).toBe('Connection 3')
  })

  it('puts the given ids first and keeps the others in order', () => {
    expect(reorderIds(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'a', 'b', 'd'])
    expect(reorderIds(['a', 'b'], ['x', 'b', 'b'])).toEqual(['b', 'a'])
    expect(reorderIds([], ['a'])).toEqual([])
  })
})

describe('duplicateProfile', () => {
  it('copies with new ids, a unique name and fresh timestamps', () => {
    const source = createConnectionProfile({
      name: 'Broker',
      clientId: 'mqtey_0a1b2c3d',
      lastConnectedAt: 5,
      subscriptions: [createSubscription({ topic: 'a/#' })]
    })
    const copy = duplicateProfile(source, ['Broker', 'Broker copy'], 1234)
    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('Broker copy 2')
    expect(copy.createdAt).toBe(1234)
    expect(copy.updatedAt).toBe(1234)
    expect(copy).not.toHaveProperty('lastConnectedAt')
    expect(copy.subscriptions[0]).toMatchObject({ topic: 'a/#' })
    expect(copy.subscriptions[0].id).not.toBe(source.subscriptions[0].id)
    expect(copy.clientId).toMatch(/^mqtey_[0-9a-f]{8}$/)
    expect(copy.clientId).not.toBe(source.clientId)
    expect(copy.tls).not.toBe(source.tls)
    expect(source.name).toBe('Broker')
  })

  it('keeps custom and empty client ids', () => {
    expect(duplicateProfile(createConnectionProfile({ clientId: 'thing-1' }), []).clientId).toBe(
      'thing-1'
    )
    expect(duplicateProfile(createConnectionProfile({ clientId: '' }), []).clientId).toBe('')
  })

  it('follows the shared fresh-identity rule of imports (CT-08)', () => {
    const source = createConnectionProfile({
      name: 'Plant',
      clientId: 'mqtey_0a1b2c3d',
      subscriptions: [createSubscription({ topic: 'a/#', createdAt: 7 })]
    })
    const copy = duplicateProfile(source, [], 99)
    const shared = withFreshIdentity(source, { name: 'Plant copy', now: 99 })
    const strip = (p: typeof copy): unknown => ({
      ...p,
      id: 'x',
      clientId: 'x',
      subscriptions: p.subscriptions.map((sub) => ({ ...sub, id: 'x' }))
    })
    expect(strip(copy)).toEqual(strip(shared))
    // Subscription timestamps are kept; the copy is plain data.
    expect(copy.subscriptions[0].createdAt).toBe(7)
    expect(isGeneratedClientId(copy.clientId)).toBe(true)
  })

  it('reads its protocol labels from the shared table', () => {
    for (const version of [3, 4, 5] as const) {
      expect(protocolLabel(version)).toBe(sharedProtocolLabel(version))
    }
  })
})

describe('groupProfiles', () => {
  it('puts the ungrouped profiles first, then the groups in natural order', () => {
    const profile = (name: string, group: string): ConnectionProfile =>
      createConnectionProfile({ name, group })
    const list = [
      profile('a', 'Lab 10'),
      profile('b', ''),
      profile('c', ' Lab 2 '),
      profile('d', 'Lab 10'),
      profile('e', '  '),
      profile('f', 'Lab 2')
    ]
    const groups = groupProfiles(list)
    expect(groups.map((g) => [g.name, g.profiles.map((p) => p.name)])).toEqual([
      ['', ['b', 'e']],
      ['Lab 2', ['c', 'f']],
      ['Lab 10', ['a', 'd']]
    ])
    // The profiles themselves, not copies (the store hands them to the sidebar).
    expect(groups[1].profiles[0]).toBe(list[2])
  })

  it('has no ungrouped entry when every profile has a group, and nothing for no profiles', () => {
    const groups = groupProfiles([createConnectionProfile({ name: 'x', group: 'G' })])
    expect(groups.map((g) => g.name)).toEqual(['G'])
    expect(groupProfiles([])).toEqual([])
  })
})
