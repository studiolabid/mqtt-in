/**
 * Persisted application settings (`settings.json`), always complete (merged over defaults).
 */
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { AppSettings } from '@shared/models'
import { parseSettingsPatch, sanitizeSettings } from '../../schemas/settings'
import type { JsonFile } from './json-file'

export class SettingsRepo {
  constructor(private readonly file: JsonFile<AppSettings>) {
    file.load({ ...DEFAULT_SETTINGS }, sanitizeSettings)
  }

  /** The current settings (a copy). */
  get(): AppSettings {
    return { ...this.file.get() }
  }

  /**
   * Applies a patch (validated: known keys and values only, `maxMessagesPerConnection`
   * clamped to `LIMITS`) and returns the complete settings. Throws on invalid input.
   */
  update(patch: Partial<AppSettings>): AppSettings {
    const clean = parseSettingsPatch(patch)
    const next = { ...this.file.get(), ...clean }
    this.file.set(next)
    return { ...next }
  }
}
