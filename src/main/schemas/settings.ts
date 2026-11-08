/**
 * Validation of `AppSettings` patches (IPC) and of the settings file on disk.
 */
import { z } from 'zod'
import { DEFAULT_SETTINGS, LIMITS } from '@shared/defaults'
import type { AppSettings } from '@shared/models'
import { formatIssues, stripUndefined } from './common'
import { ACCENT_COLORS, THEME_MODES, TIMESTAMP_FORMATS, VIEW_FORMATS } from './enums'

/** Rounds and clamps the ring-buffer size into `LIMITS.maxMessagesPerConnection`. */
export function clampMaxMessages(value: number): number {
  const { min, max } = LIMITS.maxMessagesPerConnection
  return Math.min(max, Math.max(min, Math.round(value)))
}

const settingsFields: { [K in keyof AppSettings]: z.ZodType<AppSettings[K]> } = {
  theme: z.enum(THEME_MODES),
  accent: z.enum(ACCENT_COLORS),
  maxMessagesPerConnection: z.number().transform(clampMaxMessages),
  defaultViewFormat: z.enum(VIEW_FORMATS),
  timestampFormat: z.enum(TIMESTAMP_FORMATS),
  showMilliseconds: z.boolean(),
  autoScroll: z.boolean(),
  wordWrap: z.boolean(),
  confirmBeforeDelete: z.boolean()
}

const settingsPatchSchema = z.strictObject(settingsFields).partial()

/**
 * Validates a settings patch: only known keys and enum values are accepted,
 * `maxMessagesPerConnection` is clamped. Throws `Error("Invalid settings: …")`.
 */
export function parseSettingsPatch(input: unknown): Partial<AppSettings> {
  const result = settingsPatchSchema.safeParse(input)
  if (!result.success) throw new Error(`Invalid settings: ${formatIssues(result.error)}`)
  return stripUndefined(result.data)
}

/**
 * Reads settings from an untrusted source (the settings file): every valid field is kept,
 * invalid or missing ones fall back to `DEFAULT_SETTINGS`. Never throws.
 */
export function sanitizeSettings(raw: unknown): AppSettings {
  const source: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const settings: AppSettings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(settingsFields) as (keyof AppSettings)[]) {
    assignIfValid(settings, key, source[key])
  }
  return settings
}

function assignIfValid<K extends keyof AppSettings>(
  target: AppSettings,
  key: K,
  value: unknown
): void {
  const parsed = settingsFields[key].safeParse(value)
  if (parsed.success) target[key] = parsed.data
}
