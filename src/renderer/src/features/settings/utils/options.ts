/**
 * Static option lists of the settings page (sections, themes, accents, timestamp formats).
 */
import type { Component } from 'vue'
import {
  DatabaseIcon,
  InfoIcon,
  KeyboardIcon,
  MessagesSquareIcon,
  MonitorIcon,
  MoonIcon,
  MousePointerClickIcon,
  PaletteIcon,
  SunIcon
} from '@lucide/vue'
import type { AccentColor, ThemeMode, TimestampFormat } from '@shared/models'
import { ACCENTS, type AccentDefinition } from '@/lib/accents'

export type SettingsSectionId =
  'appearance' | 'messages' | 'behaviour' | 'data' | 'shortcuts' | 'about'

export interface SettingsSectionInfo {
  id: SettingsSectionId
  label: string
  icon: Component
}

export const SETTINGS_SECTIONS: readonly SettingsSectionInfo[] = [
  { id: 'appearance', label: 'Appearance', icon: PaletteIcon },
  { id: 'messages', label: 'Messages', icon: MessagesSquareIcon },
  { id: 'behaviour', label: 'Behaviour', icon: MousePointerClickIcon },
  { id: 'data', label: 'Data', icon: DatabaseIcon },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: KeyboardIcon },
  { id: 'about', label: 'About', icon: InfoIcon }
]

/** DOM id of a section (scroll target). */
export function sectionDomId(id: SettingsSectionId): string {
  return `settings-section-${id}`
}

export const THEME_OPTIONS: readonly { value: ThemeMode; label: string; icon: Component }[] = [
  { value: 'system', label: 'System', icon: MonitorIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon }
]

/**
 * Entries of the accent picker: the single accent table (`@/lib/accents`, CT-18), Mono (zinc)
 * first and the default. The swatches show the tokens the theme applies.
 */
export const ACCENT_OPTIONS: readonly AccentDefinition[] = ACCENTS

/** CSS variables of a swatch: the accent's primary color and its foreground in a theme. */
export function accentSwatchStyle(accent: AccentDefinition, dark: boolean): Record<string, string> {
  const tokens = dark ? accent.dark : accent.light
  return { '--swatch': tokens.primary, '--swatch-foreground': tokens.primaryForeground }
}

/** True for a known accent value (old settings may hold one that no longer exists). */
export function isAccentColor(value: unknown): value is AccentColor {
  return ACCENTS.some((accent) => accent.value === value)
}

export const TIMESTAMP_OPTIONS: readonly { value: TimestampFormat; label: string }[] = [
  { value: 'time', label: 'Time' },
  { value: 'datetime', label: 'Date & time' },
  { value: 'relative', label: 'Relative' }
]

/** Quick picks for the message buffer size. */
export const MAX_MESSAGE_PRESETS: readonly { value: number; label: string }[] = [
  { value: 1_000, label: '1K' },
  { value: 10_000, label: '10K' },
  { value: 50_000, label: '50K' },
  { value: 100_000, label: '100K' }
]

/** `win32` → `Windows`, `darwin` → `macOS`… */
export function platformName(platform: string): string {
  switch (platform) {
    case 'win32':
      return 'Windows'
    case 'darwin':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}
