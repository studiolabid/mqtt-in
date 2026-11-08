/**
 * FP-4 / HEALTH-07: one "Copy as command" menu model for every publish (a message, a history
 * entry): `commandMenuItems` and the `copiedToast` text, with the PowerShell 5.1 caveat.
 */
import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@shared/models'
import { createConnectionProfile } from '@shared/defaults'
import {
  commandMenuItems,
  copiedToast,
  NO_PROFILE_ERROR,
  type PublishCommandInput
} from '@/utils/cli-command'
import { utf8 } from './helpers'

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return createConnectionProfile({
    host: 'broker.example.com',
    port: 1883,
    clientId: 'mqttin_0a1b2c3d',
    ...overrides
  })
}

function publish(overrides: Partial<PublishCommandInput> = {}): PublishCommandInput {
  return {
    profile: profile(),
    topic: 'home/temp',
    payload: utf8('21.5'),
    qos: 0,
    retain: false,
    ...overrides
  }
}

describe('the "Copy as command" menu of a publish (one model for messages and history)', () => {
  it('offers mosquitto_pub and mqttx pub; refused tools are disabled with the reason', () => {
    const ws = publish({ profile: profile({ protocol: 'ws', port: 8083 }) })
    const [mosquitto, mqttx] = commandMenuItems(ws, 'posix')
    expect([mosquitto.label, mosquitto.testId, mqttx.label, mqttx.testId]).toEqual([
      'mosquitto_pub',
      'copy-as-mosquitto',
      'mqttx pub',
      'copy-as-mqttx'
    ])
    expect(mosquitto.reason).toMatch(/^mosquitto_pub cannot connect over WebSockets/)
    expect(mqttx.reason).toBeUndefined()
    expect(mqttx.result.ok).toBe(true)
  })

  it('disables both tools without a profile or for a publish that cannot be built', () => {
    expect(commandMenuItems(null, 'posix').map((item) => item.reason)).toEqual([
      NO_PROFILE_ERROR,
      NO_PROFILE_ERROR
    ])
    const invalid = commandMenuItems({ error: 'Topic is required' }, 'powershell')
    expect(invalid.every((item) => !item.result.ok && item.reason === 'Topic is required')).toBe(
      true
    )
  })

  it('says in the copied toast what to know before running the command', () => {
    const json = publish({ payload: utf8('{"on":true}'), profile: profile({ password: 'pw' }) })
    const [item] = commandMenuItems(json, 'powershell')
    if (!item.result.ok) throw new Error(item.result.error)
    expect(item.result.warning).toBeDefined()
    expect(copiedToast(item.result)).toEqual({
      title: 'Command copied',
      description: `Password not included — set MQTT_PASSWORD. ${item.result.warning}`
    })
    // POSIX shells keep the quotes: no caveat; no password: no note.
    const [posix] = commandMenuItems(publish({ payload: utf8('{"on":true}') }), 'posix')
    expect(posix.result.ok && copiedToast(posix.result)).toEqual({ title: 'Command copied' })
  })
})
