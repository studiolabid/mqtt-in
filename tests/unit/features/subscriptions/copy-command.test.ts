import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() })
}))

import { toast } from 'vue-sonner'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import type { CliResult } from '@/utils/cli-command'
import { copyCommand, subscriptionCommandItems } from '@/features/subscriptions/utils/copy-command'

/** Runs `copyCommand` with a stubbed clipboard; returns what was written. */
async function copied(result: CliResult): Promise<{ ok: boolean; text: string[] }> {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  try {
    const ok = await copyCommand(result)
    return { ok, text: writeText.mock.calls.map(([text]) => text) }
  } finally {
    vi.unstubAllGlobals()
  }
}

describe('Copy as command ▸ mosquitto_sub / mqttx sub (FP-4)', () => {
  const profile = createConnectionProfile({ host: 'broker.local', port: 1883 })
  const subscription = createSubscription({ topic: 'home/#', qos: 1 })

  it('calls the generator with the subscription and the profile, for both tools', () => {
    const generate = vi.fn((): CliResult => ({ ok: true, command: 'cmd' }))
    const items = subscriptionCommandItems(profile, subscription, 'posix', generate)
    expect(generate).toHaveBeenCalledWith({ profile, subscription }, 'mosquitto_sub', 'posix')
    expect(generate).toHaveBeenCalledWith({ profile, subscription }, 'mqttx', 'posix')
    expect(items.map((item) => [item.label, item.disabled])).toEqual([
      ['mosquitto_sub', false],
      ['mqttx sub', false]
    ])
  })

  it('disables an entry the generator refuses, with its reason', () => {
    const generate = vi.fn((_input: unknown, tool: string): CliResult =>
      tool === 'mosquitto_sub' ? { ok: false, error: 'No WebSockets' } : { ok: true, command: 'x' }
    )
    const [mosquitto, mqttx] = subscriptionCommandItems(
      profile,
      subscription,
      'powershell',
      generate
    )
    expect(mosquitto).toMatchObject({ disabled: true, reason: 'No WebSockets' })
    expect(mqttx).toMatchObject({ disabled: false })
    expect(mqttx.reason).toBeUndefined()
  })

  it('builds real commands, mosquitto refused over WebSockets', () => {
    const ws = createConnectionProfile({ protocol: 'ws', host: 'broker.local', port: 8083 })
    const [mosquitto, mqttx] = subscriptionCommandItems(ws, subscription, 'posix')
    expect(mosquitto.disabled).toBe(true)
    expect(mosquitto.reason).toMatch(/WebSockets/)
    expect(mqttx.result.ok && mqttx.result.command).toContain('home/#')
  })

  it('tells which variable holds the password, never the password', async () => {
    vi.mocked(toast.success).mockClear()
    const secret = createConnectionProfile({ host: 'b', username: 'alice', password: 'hunter2' })
    const [mosquitto] = subscriptionCommandItems(secret, subscription, 'posix')
    expect(mosquitto.result.ok && mosquitto.result.command).not.toContain('hunter2')
    const { ok, text } = await copied(mosquitto.result)
    expect(ok).toBe(true)
    expect(text).toEqual([mosquitto.result.ok ? mosquitto.result.command : ''])
    expect(toast.success).toHaveBeenCalledWith('Command copied', {
      description: 'Password not included — set MQTT_PASSWORD'
    })
  })

  it('shows the Windows PowerShell 5.1 caveat of a command with double quotes (CT-15)', async () => {
    vi.mocked(toast.success).mockClear()
    const quoted = createSubscription({ topic: 'say/"hi"/#' })
    const [, mqttx] = subscriptionCommandItems(profile, quoted, 'powershell')
    expect(mqttx.result.ok && mqttx.result.warning).toMatch(/PowerShell 7\.3/)
    expect((await copied(mqttx.result)).ok).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('Command copied', {
      description: expect.stringMatching(/Windows PowerShell 5\.1/)
    })
  })

  it('copies nothing for a refused entry and says why', async () => {
    vi.mocked(toast.error).mockClear()
    const { ok, text } = await copied({ ok: false, error: 'No WebSockets' })
    expect(ok).toBe(false)
    expect(text).toEqual([])
    expect(toast.error).toHaveBeenCalledWith('Could not copy the command', {
      description: 'No WebSockets'
    })
  })
})
