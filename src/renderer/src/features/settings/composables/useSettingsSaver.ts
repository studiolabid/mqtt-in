/**
 * Instant-apply settings with quiet feedback: `save(patch)` persists through the settings
 * store (which shows a toast on failure) and flips `status` to `saved` for a moment, shown by
 * the page header. Provided by `SettingsView`, injected by the sections.
 */
import { inject, provide, readonly, ref, type InjectionKey, type Ref } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import type { AppSettings } from '@shared/models'
import { useSettingsStore } from '@/stores/settings'

export type SaveStatus = 'idle' | 'saved'

export interface SettingsSaver {
  /** Applies and persists `patch`; no-op patches resolve `true` without a round trip. */
  save(patch: Partial<AppSettings>): Promise<boolean>
  status: Readonly<Ref<SaveStatus>>
}

const SAVED_FEEDBACK_MS = 1600
const KEY: InjectionKey<SettingsSaver> = Symbol('settings-saver')

function createSettingsSaver(): SettingsSaver {
  const settings = useSettingsStore()
  const status = ref<SaveStatus>('idle')
  const { start } = useTimeoutFn(
    () => {
      status.value = 'idle'
    },
    SAVED_FEEDBACK_MS,
    { immediate: false }
  )

  async function save(patch: Partial<AppSettings>): Promise<boolean> {
    const current = settings.settings
    const changed = (Object.keys(patch) as (keyof AppSettings)[]).some(
      (key) => patch[key] !== undefined && patch[key] !== current[key]
    )
    if (!changed) return true
    const ok = await settings.update(patch)
    if (ok) {
      status.value = 'saved'
      start()
    }
    return ok
  }

  return { save, status: readonly(status) }
}

/** Creates the page's saver and provides it to the sections. */
export function provideSettingsSaver(): SettingsSaver {
  const saver = createSettingsSaver()
  provide(KEY, saver)
  return saver
}

/** The page's saver (or a standalone one outside the settings page). */
export function useSettingsSaver(): SettingsSaver {
  return inject(KEY, null) ?? createSettingsSaver()
}
