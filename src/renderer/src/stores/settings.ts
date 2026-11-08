/**
 * Application settings (persisted by the main process).
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { usePreferredDark } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { AppSettings } from '@shared/models'
import { DEFAULT_SETTINGS, LIMITS } from '@shared/defaults'
import { api, errorMessage } from '@/services/api'

type SettingsKey = keyof AppSettings

function assignSetting<K extends SettingsKey>(
  target: AppSettings,
  source: AppSettings,
  key: K
): void {
  target[key] = source[key]
}

/** Drops `undefined` values and clamps numbers to the shared limits. */
function sanitizePatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  const clean: Partial<AppSettings> = {}
  for (const key of Object.keys(patch) as SettingsKey[]) {
    if (patch[key] === undefined || !(key in DEFAULT_SETTINGS)) continue
    Object.assign(clean, { [key]: patch[key] })
  }
  if (clean.maxMessagesPerConnection !== undefined) {
    const { min, max } = LIMITS.maxMessagesPerConnection
    const value = Math.round(clean.maxMessagesPerConnection)
    clean.maxMessagesPerConnection = Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : min
  }
  return clean
}

export const useSettingsStore = defineStore('settings', () => {
  /** Current settings; `DEFAULT_SETTINGS` until `load()` resolves. */
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })
  /** True once `load()` finished (successfully or not). */
  const loaded = ref(false)
  const preferredDark = usePreferredDark()

  /** Effective dark mode: `dark`, or `system` while the OS prefers a dark color scheme. */
  const isDark = computed(
    () =>
      settings.value.theme === 'dark' || (settings.value.theme === 'system' && preferredDark.value)
  )

  /** Loads the persisted settings. Rejects on IPC failure (defaults stay active). */
  async function load(): Promise<void> {
    try {
      const stored = await api.settings.get()
      settings.value = { ...DEFAULT_SETTINGS, ...stored }
    } finally {
      loaded.value = true
    }
  }

  /**
   * Applies `patch` optimistically and persists it. On failure only the keys that still hold
   * the optimistic value are rolled back (concurrent updates survive) and a toast is shown.
   *
   * @returns whether the change was persisted.
   */
  async function update(patch: Partial<AppSettings>): Promise<boolean> {
    const clean = sanitizePatch(patch)
    const keys = Object.keys(clean) as SettingsKey[]
    if (keys.length === 0) return true
    const previous = { ...settings.value }
    const optimistic = { ...settings.value, ...clean }
    settings.value = optimistic

    try {
      const stored = await api.settings.update(clean)
      // Adopt the stored (validated) values, but only for keys nobody changed meanwhile.
      const next = { ...settings.value }
      for (const key of keys) {
        if (settings.value[key] === optimistic[key] && key in stored) {
          assignSetting(next, stored, key)
        }
      }
      settings.value = next
      return true
    } catch (err) {
      const next = { ...settings.value }
      for (const key of keys) {
        if (settings.value[key] === optimistic[key]) assignSetting(next, previous, key)
      }
      settings.value = next
      toast.error('Could not save settings', { description: errorMessage(err) })
      return false
    }
  }

  /** Switches between light and dark (an explicit choice, leaving `system`). */
  function toggleTheme(): Promise<boolean> {
    return update({ theme: isDark.value ? 'light' : 'dark' })
  }

  /** Restores every setting to its default value. */
  function resetToDefaults(): Promise<boolean> {
    return update({ ...DEFAULT_SETTINGS })
  }

  return { settings, loaded, isDark, load, update, toggleTheme, resetToDefaults }
})
