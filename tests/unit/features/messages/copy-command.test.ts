/**
 * FP-4 (messages part): the "Copy as command" submenu model, built from a message and the
 * connection's profile, and the copy action's toast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createConnectionProfile } from '@shared/defaults'
import {
  commandMenuItems,
  copiedToast,
  copyCommand,
  messageCommandInput,
  useCopyCommand
} from '@/features/messages/composables/useCopyCommand'
import { message, utf8 } from '../../renderer/helpers'
import { setupStores } from '../../renderer/stores/setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

const profile = createConnectionProfile({
  host: 'broker.local',
  port: 1883,
  protocol: 'mqtt',
  protocolVersion: 5,
  clientId: 'bench-1',
  username: 'alice',
  password: 'secret'
})

describe('messageCommandInput', () => {
  it('takes the exact bytes, flags and publish properties of the message', () => {
    const input = messageCommandInput(
      profile,
      message({
        topic: 'home/temp',
        payload: utf8('21.5'),
        qos: 1,
        retain: true,
        properties: {
          contentType: 'text/plain',
          topicAlias: 3,
          subscriptionIdentifier: [7],
          userProperties: [{ key: 'unit', value: 'C' }]
        }
      })
    )
    expect(input).toMatchObject({ topic: 'home/temp', qos: 1, retain: true, profile })
    expect(Array.from(input.payload)).toEqual(Array.from(utf8('21.5')))
    expect(input.properties).toMatchObject({
      contentType: 'text/plain',
      userProperties: [{ key: 'unit', value: 'C' }]
    })
    // Delivery details are not publish properties.
    expect(input.properties).not.toHaveProperty('topicAlias')
    expect(input.properties).not.toHaveProperty('subscriptionIdentifier')
  })
})

describe('commandMenuItems', () => {
  it('offers mosquitto_pub and mqttx pub with the right test ids', () => {
    const items = commandMenuItems(
      messageCommandInput(profile, message({ topic: 'home/temp', payload: utf8('21.5') })),
      'posix'
    )
    expect(items.map((item) => [item.label, item.testId])).toEqual([
      ['mosquitto_pub', 'copy-as-mosquitto'],
      ['mqttx pub', 'copy-as-mqttx']
    ])
    const [mosquitto, mqttx] = items
    expect(mosquitto.result.ok && mosquitto.result.command).toBe(
      'mosquitto_pub -h broker.local -p 1883 -V mqttv5 -i bench-1 -u alice -P "$MQTT_PASSWORD" -t home/temp -m 21.5'
    )
    expect(mqttx.result.ok && mqttx.result.command.startsWith('mqttx pub ')).toBe(true)
    expect(mosquitto.reason).toBeUndefined()
  })

  it('disables an item the generator refuses, with its reason', () => {
    const websocket = { ...profile, protocol: 'ws' as const, port: 8083 }
    const [mosquitto, mqttx] = commandMenuItems(
      messageCommandInput(websocket, message({ payload: utf8('on') })),
      'posix'
    )
    expect(mosquitto.result.ok).toBe(false)
    expect(mosquitto.reason).toBe(
      'mosquitto_pub cannot connect over WebSockets: copy the MQTTX command instead'
    )
    expect(mqttx.result.ok).toBe(true)

    const binary = commandMenuItems(
      messageCommandInput(profile, message({ payload: new Uint8Array([0xff, 0xfe]) })),
      'posix'
    )
    expect(
      binary.every((item) => item.reason === 'Binary payloads cannot be copied as a command yet')
    ).toBe(true)
  })

  it('disables both items without a profile or for an unpublishable source', () => {
    expect(commandMenuItems(null, 'posix').map((item) => item.reason)).toEqual([
      'The connection no longer exists',
      'The connection no longer exists'
    ])
    expect(commandMenuItems({ error: 'Topic is required' }, 'posix')[0].reason).toBe(
      'Topic is required'
    )
  })
})

describe('copying', () => {
  const writeText = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('says how to provide the password', () => {
    expect(copiedToast({ ok: true, command: 'x', passwordVariable: 'MQTT_PASSWORD' })).toEqual({
      title: 'Command copied',
      description: 'Password not included — set MQTT_PASSWORD'
    })
    expect(copiedToast({ ok: true, command: 'x' })).toEqual({ title: 'Command copied' })
  })

  it('copies the command and toasts', async () => {
    const [item] = commandMenuItems(
      messageCommandInput(profile, message({ topic: 'a/b', payload: utf8('1') })),
      'posix'
    )
    await expect(copyCommand(item)).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith(item.result.ok ? item.result.command : '')
    expect(toast.success).toHaveBeenCalledWith('Command copied', {
      description: 'Password not included — set MQTT_PASSWORD'
    })
  })

  it('never copies a disabled item', async () => {
    const [item] = commandMenuItems(null, 'posix')
    await expect(copyCommand(item)).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('builds the items from the stored profile for the platform shell', async () => {
    const setup = await setupStores([{ host: 'h', protocolVersion: 4, clientId: '' }])
    const id = setup.profiles[0].id
    // The fake bridge reports win32: PowerShell quoting.
    const [mosquitto] = useCopyCommand(id).itemsFor(
      message({ topic: "it's/here", payload: utf8('x') })
    )
    expect(mosquitto.result.ok && mosquitto.result.command).toBe(
      "mosquitto_pub -h h -p 1883 -V mqttv311 -t 'it''s/here' -m x"
    )
  })
})
