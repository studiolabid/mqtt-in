import { describe, expect, it } from 'vitest'
import { createConnectionProfile } from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import { buildClientOptions } from '../../../src/main/services/mqtt/client-options'

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return createConnectionProfile({ clientId: 'client-1', ...overrides })
}

describe('buildClientOptions — MQTT string limits of the CONNECT', () => {
  const tooLong = 'is too long (max 65535 bytes)'
  const lone = String.fromCharCode(0xd800)

  function withWill(overrides: Partial<ConnectionProfile['will']>): ConnectionProfile {
    const base = profile()
    return { ...base, will: { ...base.will, enabled: true, topic: 'status/x', ...overrides } }
  }

  it('refuses a client id over 65,535 UTF-8 bytes', () => {
    expect(() => buildClientOptions(profile({ clientId: 'c'.repeat(70_000) }))).toThrow(
      'Client ID is too long (max 65535 bytes)'
    )
    // Bytes, not characters: 30,000 euro signs take 90,000 bytes.
    expect(() => buildClientOptions(profile({ clientId: '€'.repeat(30_000) }))).toThrow(tooLong)
    expect(() => buildClientOptions(profile({ clientId: 'c'.repeat(65_535) }))).not.toThrow()
  })

  it('refuses an unpaired surrogate in the user name and a long password', () => {
    expect(() => buildClientOptions(profile({ username: `a${lone}b` }))).toThrow(
      'User name contains an unpaired surrogate'
    )
    expect(() => buildClientOptions(profile({ password: 'ü'.repeat(40_000) }))).toThrow(
      `Password ${tooLong}`
    )
  })

  it('checks the will topic, message and properties', () => {
    expect(() => buildClientOptions(withWill({ topic: 'w'.repeat(70_000) }))).toThrow(
      `Will topic ${tooLong}`
    )
    expect(() => buildClientOptions(withWill({ payload: 'x'.repeat(70_000) }))).toThrow(
      `Will message ${tooLong}`
    )
    const users = { userProperties: [{ key: 'k', value: '€'.repeat(30_000) }] }
    expect(() => buildClientOptions(withWill({ properties: users }))).toThrow(
      `Will user property value ${tooLong}`
    )
    const contentType = { contentType: 'ü'.repeat(40_000), userProperties: [] }
    expect(() => buildClientOptions(withWill({ properties: contentType }))).toThrow(
      `Will content type ${tooLong}`
    )
  })

  it('checks the connect user properties of MQTT 5 profiles only', () => {
    const long = { userProperties: [{ key: 'k', value: 'v'.repeat(90_000) }] }
    expect(() => buildClientOptions({ ...profile(), properties: long })).toThrow(
      `User property value ${tooLong}`
    )
    const v311 = profile({ protocolVersion: 4 })
    expect(() => buildClientOptions({ ...v311, properties: long })).not.toThrow()
  })
})
