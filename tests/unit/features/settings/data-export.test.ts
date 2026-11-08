import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() })
}))

import { useConnectionExport } from '@/features/settings/composables/useConnectionExport'
import { useConnectionsStore } from '@/stores'
import { setupStores } from '../../renderer/stores/setup'

describe('Settings > Data export (SEC-10, UX-13)', () => {
  it('exports without passwords by default', async () => {
    const { bridge } = await setupStores([{ name: 'A', password: 'hunter2' }])
    const exporter = useConnectionExport()
    expect(exporter.includeSecrets.value).toBe(false)
    await exporter.exportAll()
    expect(bridge.api.connections.exportToFile).toHaveBeenCalledWith(undefined, {
      includeSecrets: false
    })
  })

  it('passes the opt-in through and resets it after the export', async () => {
    const { bridge } = await setupStores([{ name: 'A', password: 'hunter2' }])
    vi.mocked(bridge.api.connections.exportToFile).mockResolvedValueOnce('C:\\tmp\\all.json')
    const exporter = useConnectionExport()
    exporter.includeSecrets.value = true
    expect(await exporter.exportAll()).toBe('C:\\tmp\\all.json')
    expect(bridge.api.connections.exportToFile).toHaveBeenCalledWith(undefined, {
      includeSecrets: true
    })
    expect(exporter.includeSecrets.value).toBe(false)
    expect(exporter.exporting.value).toBe(false)
  })

  it('shares the store busy state with every other export entry point (RC-22)', async () => {
    const { bridge } = await setupStores([{ name: 'A' }])
    let finish: (value: string | null) => void = () => undefined
    vi.mocked(bridge.api.connections.exportToFile).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve))
    )
    const exporter = useConnectionExport()
    const fromSidebar = useConnectionsStore().exportToFile()
    expect(exporter.exporting.value).toBe(true)
    expect(await exporter.exportAll()).toBeNull()
    expect(bridge.api.connections.exportToFile).toHaveBeenCalledTimes(1)
    finish(null)
    await fromSidebar
    expect(exporter.exporting.value).toBe(false)
  })

  it('also resets the opt-in when the save dialog is cancelled or the export fails', async () => {
    const { bridge } = await setupStores([{ name: 'A' }])
    const exporter = useConnectionExport()
    exporter.includeSecrets.value = true
    expect(await exporter.exportAll()).toBeNull() // the fake dialog is cancelled
    expect(exporter.includeSecrets.value).toBe(false)

    vi.mocked(bridge.api.connections.exportToFile).mockRejectedValueOnce(new Error('disk full'))
    exporter.includeSecrets.value = true
    expect(await exporter.exportAll()).toBeNull()
    expect(exporter.includeSecrets.value).toBe(false)
  })
})
