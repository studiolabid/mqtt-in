import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { useSettingsStore } from '@/stores/settings'
import { setupStores, type StoreSetup } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

describe('useSettingsStore', () => {
  let setup: StoreSetup

  beforeEach(async () => {
    vi.clearAllMocks()
    setup = await setupStores()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts with the defaults and loads the persisted settings', async () => {
    const store = useSettingsStore()
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
    expect(store.loaded).toBe(false)
    vi.mocked(setup.bridge.api.settings.get).mockResolvedValueOnce({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      accent: 'rose'
    })
    await store.load()
    expect(store.loaded).toBe(true)
    expect(store.settings.accent).toBe('rose')
    expect(store.isDark).toBe(true)
  })

  it('fills settings missing from older files with defaults', async () => {
    const store = useSettingsStore()
    vi.mocked(setup.bridge.api.settings.get).mockResolvedValueOnce({ theme: 'light' } as never)
    await store.load()
    expect(store.settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' })
  })

  it('is loaded (with defaults) even when loading fails', async () => {
    const store = useSettingsStore()
    vi.mocked(setup.bridge.api.settings.get).mockRejectedValueOnce(new Error('disk'))
    await expect(store.load()).rejects.toThrow('disk')
    expect(store.loaded).toBe(true)
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('applies updates optimistically and clamps limits', async () => {
    const store = useSettingsStore()
    const pending = store.update({ maxMessagesPerConnection: 5, autoScroll: false })
    expect(store.settings.autoScroll).toBe(false)
    expect(store.settings.maxMessagesPerConnection).toBe(100)
    await expect(pending).resolves.toBe(true)
    expect(setup.bridge.api.settings.update).toHaveBeenCalledWith({
      maxMessagesPerConnection: 100,
      autoScroll: false
    })
  })

  it('adopts the values validated by the main process', async () => {
    const store = useSettingsStore()
    vi.mocked(setup.bridge.api.settings.update).mockResolvedValueOnce({
      ...DEFAULT_SETTINGS,
      maxMessagesPerConnection: 12_345
    })
    await store.update({ maxMessagesPerConnection: 20_000 })
    expect(store.settings.maxMessagesPerConnection).toBe(12_345)
  })

  it('rolls back and shows a toast when saving fails', async () => {
    const store = useSettingsStore()
    vi.mocked(setup.bridge.api.settings.update).mockRejectedValueOnce(
      new Error("Error invoking remote method 'settings:update': Error: read-only")
    )
    await expect(store.update({ theme: 'dark' })).resolves.toBe(false)
    expect(store.settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(toast.error).toHaveBeenCalledWith('Could not save settings', {
      description: 'read-only'
    })
  })

  it('keeps concurrent changes when one update fails', async () => {
    const store = useSettingsStore()
    let reject: (err: Error) => void = () => {}
    vi.mocked(setup.bridge.api.settings.update).mockImplementationOnce(
      () => new Promise((_resolve, fail) => (reject = fail))
    )
    const failing = store.update({ theme: 'dark' })
    await store.update({ accent: 'emerald' })
    reject(new Error('nope'))
    await failing
    expect(store.settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(store.settings.accent).toBe('emerald')
  })

  it('ignores empty patches and unknown keys', async () => {
    const store = useSettingsStore()
    await expect(store.update({ theme: undefined })).resolves.toBe(true)
    await store.update({ bogus: 1 } as never)
    expect(setup.bridge.api.settings.update).not.toHaveBeenCalled()
  })

  it('toggles between light and dark', async () => {
    const store = useSettingsStore()
    expect(store.isDark).toBe(false) // system theme, no dark preference in tests
    await store.toggleTheme()
    expect(store.settings.theme).toBe('dark')
    expect(store.isDark).toBe(true)
    await store.toggleTheme()
    expect(store.settings.theme).toBe('light')
  })

  it('resets to the defaults', async () => {
    const store = useSettingsStore()
    await store.update({ accent: 'rose', wordWrap: false })
    await store.resetToDefaults()
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
  })
})
