import { afterEach, describe, expect, it, vi } from 'vitest'
import { isProxy, reactive } from 'vue'
import { createConnectionProfile } from '@shared/defaults'
import { api, errorMessage, isBridgeAvailable } from '@/services/api'
import { installFakeBridge, storageNotice } from './helpers'

describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws a clear error when the preload bridge is missing', () => {
    expect(isBridgeAvailable()).toBe(false)
    expect(() => api.connections).toThrow(/window\.mqttIn/)
    vi.stubGlobal('window', {})
    expect(() => api.mqtt).toThrow(/preload/)
  })

  it('forwards calls with plain copies of reactive arguments', async () => {
    const bridge = installFakeBridge()
    expect(isBridgeAvailable()).toBe(true)
    const profile = reactive(createConnectionProfile({ name: 'R' }))
    await api.connections.save(profile)
    const sent = vi.mocked(bridge.api.connections.save).mock.calls[0][0]
    expect(isProxy(sent)).toBe(false)
    expect(isProxy(sent.tls)).toBe(false)
    expect(sent).toEqual(JSON.parse(JSON.stringify(profile)))
    expect(() => structuredClone(sent)).not.toThrow()
  })

  it('passes binary payloads through without copying them', async () => {
    const bridge = installFakeBridge()
    const payload = new Uint8Array([1, 2, 3])
    await api.mqtt.publish('c', reactive({ topic: 't', payload, qos: 0, retain: false }))
    expect(vi.mocked(bridge.api.mqtt.publish).mock.calls[0][1].payload).toBe(payload)
  })

  it('exposes the platform and event subscriptions', () => {
    const bridge = installFakeBridge()
    expect(api.app.platform).toBe('win32')
    const listener = vi.fn()
    const off = api.mqtt.onStatus(listener)
    expect(bridge.listeners.status).toContain(listener)
    off()
    expect(bridge.listeners.status).toHaveLength(0)
  })

  it('forwards the storage-notice, show-in-folder and export-option calls', async () => {
    const bridge = installFakeBridge()
    bridge.notices.push(storageNotice())
    expect(await api.app.getStorageNotices()).toEqual([storageNotice()])
    const listener = vi.fn()
    const off = api.app.onStorageNotice(listener)
    expect(bridge.listeners.storageNotice).toContain(listener)
    off()
    expect(bridge.listeners.storageNotice).toHaveLength(0)

    await api.app.showItemInFolder('C:/exports/mqtt-in-connections.json')
    expect(bridge.api.app.showItemInFolder).toHaveBeenCalledWith(
      'C:/exports/mqtt-in-connections.json'
    )

    const options = reactive({ includeSecrets: true })
    await api.connections.exportToFile(reactive(['a']), options)
    const [ids, sent] = vi.mocked(bridge.api.connections.exportToFile).mock.calls[0]
    expect(ids).toEqual(['a'])
    expect(isProxy(ids)).toBe(false)
    expect(sent).toEqual({ includeSecrets: true })
    expect(isProxy(sent)).toBe(false)
  })

  it('follows a replaced bridge', async () => {
    installFakeBridge()
    const second = installFakeBridge()
    await api.settings.get()
    expect(second.api.settings.get).toHaveBeenCalledTimes(1)
  })
})

describe('errorMessage', () => {
  it('strips the Electron remote method prefix', () => {
    expect(
      errorMessage(new Error("Error invoking remote method 'mqtt:publish': Error: Not connected"))
    ).toBe('Not connected')
    expect(errorMessage(new Error("Error invoking remote method 'x': TypeError: bad input"))).toBe(
      'bad input'
    )
    expect(errorMessage(new Error("Error invoking remote method 'x': plain reason"))).toBe(
      'plain reason'
    )
  })

  it('handles strings, message-like objects and empty values', () => {
    expect(errorMessage('boom')).toBe('boom')
    expect(errorMessage({ message: 'from object' })).toBe('from object')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(undefined)).toBe('Unknown error')
    expect(errorMessage(new Error(''))).toBe('Unknown error')
  })
})
