/**
 * `settings.*` — application settings.
 */
import { IPC } from '@shared/ipc'
import type { SettingsRepo } from '../services/storage'
import type { RegisterHandler } from './handle'
import { parseSettingsPatch } from './validate'

/** Registers `settings.get` / `settings.update`. */
export function registerSettingsIpc(register: RegisterHandler, settings: SettingsRepo): void {
  register(IPC.settingsGet, () => settings.get())
  register(IPC.settingsUpdate, (_ctx, patch) => settings.update(parseSettingsPatch(patch)))
}
