/**
 * FP-4 (publish part): a history entry copied as a command is prepared exactly as a publish
 * would send it; entries that cannot be expressed give a disabled item with the reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createConnectionProfile } from '@shared/defaults'
import {
  historyCommandInput,
  historyCommandItems,
  useHistoryCommand
} from '@/features/publish/composables/useHistoryCommand'
import type { PublishHistoryItem } from '@/types'
import { setupStores } from '../../renderer/stores/setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

const profile = createConnectionProfile({ host: 'h', protocolVersion: 5, clientId: '' })

function entry(overrides: Partial<PublishHistoryItem> = {}): PublishHistoryItem {
  return {
    id: 'h1',
    timestamp: 1,
    topic: 'lab/cmd',
    payload: '{"on": true}',
    format: 'json',
    qos: 1,
    retain: false,
    properties: { userProperties: [] },
    useTemplate: false,
    ...overrides
  }
}

describe('history entries as commands', () => {
  it('uses the encoded payload, QoS, retain and MQTT 5 properties', () => {
    const input = historyCommandInput(
      profile,
      entry({ retain: true, properties: { contentType: 'application/json', userProperties: [] } })
    )
    if ('error' in input) throw new Error(input.error)
    expect(new TextDecoder().decode(input.payload)).toBe('{"on": true}')
    expect(input).toMatchObject({ topic: 'lab/cmd', qos: 1, retain: true })
    expect(input.properties).toEqual({ contentType: 'application/json' })
    const [mosquitto] = historyCommandItems(profile, entry(), 'posix')
    expect(mosquitto.result.ok && mosquitto.result.command).toBe(
      `mosquitto_pub -h h -p 1883 -V mqttv5 -t lab/cmd -q 1 -m '{"on": true}'`
    )
  })

  it('renders templates once, as a publish would', () => {
    const input = historyCommandInput(
      profile,
      entry({ format: 'text', payload: 'n={{counter}}', useTemplate: true })
    )
    if ('error' in input) throw new Error(input.error)
    expect(new TextDecoder().decode(input.payload)).toBe('n=1')
  })

  it('disables both items for an entry that cannot be published', () => {
    const items = historyCommandItems(profile, entry({ topic: 'bad/#' }), 'posix')
    expect(items.every((item) => !item.result.ok && item.reason !== undefined)).toBe(true)
    expect(historyCommandItems(undefined, entry(), 'posix')[1].reason).toBe(
      'The connection no longer exists'
    )
  })
})

describe('copying a history entry', () => {
  const writeText = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('copies the command and toasts the password note and the PowerShell 5.1 caveat', async () => {
    const setup = await setupStores([{ host: 'h', protocolVersion: 5, password: 'pw' }])
    const command = useHistoryCommand(() => setup.profiles[0].id)
    // The fake bridge reports win32: PowerShell, where a JSON payload needs PowerShell 7.3+.
    const [mosquitto] = command.itemsFor(entry())
    if (!mosquitto.result.ok) throw new Error(mosquitto.result.error)
    await expect(command.copy(mosquitto)).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith(mosquitto.result.command)
    expect(toast.success).toHaveBeenCalledWith('Command copied', {
      description: `Password not included — set MQTT_PASSWORD. ${mosquitto.result.warning}`
    })
    expect(mosquitto.result.warning).toMatch(/PowerShell 7\.3/)
  })

  it('never copies a disabled item', async () => {
    await setupStores([])
    const command = useHistoryCommand(() => 'missing')
    const [item] = command.itemsFor(entry())
    await expect(command.copy(item)).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})
