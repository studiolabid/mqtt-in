/**
 * Keeps the document theme (light / dark class, accent tokens, native color scheme) and the
 * window title bar in sync with the settings.
 */
import { watch, watchEffect } from 'vue'
import type { AccentColor, ThemeMode } from '@shared/models'
import { ACCENT_TOKEN_PROPERTIES, accentDefinition, type AccentTokens } from '@/lib/accents'
import { api } from '@/services/api'
import { useSettingsStore } from '@/stores/settings'

/**
 * Applies a theme to `<html>`: the `dark` class, the accent's tokens as CSS custom properties
 * (`--primary`, `--ring`, `--primary-text`… from `@/lib/accents`, the single source), the
 * `data-accent` attribute (charts observe it to repaint) and `color-scheme` (native scrollbars
 * and form controls). Safe to call before the app is mounted.
 */
export function applyDocumentTheme(dark: boolean, accent: AccentColor): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const definition = accentDefinition(accent)
  const tokens = dark ? definition.dark : definition.light
  root.classList.toggle('dark', dark)
  for (const key of Object.keys(ACCENT_TOKEN_PROPERTIES) as Array<keyof AccentTokens>) {
    root.style.setProperty(ACCENT_TOKEN_PROPERTIES[key], tokens[key])
  }
  root.dataset.accent = definition.value
  root.style.colorScheme = dark ? 'dark' : 'light'
}

function syncWindowTheme(theme: ThemeMode): void {
  try {
    api.window.setTheme(theme).catch((err: unknown) => {
      console.warn('[mqtt-in] could not sync the window theme:', err)
    })
  } catch (err) {
    console.warn('[mqtt-in] could not sync the window theme:', err)
  }
}

/**
 * Call once (in `App.vue`): applies the theme immediately and on every change, and tells the
 * main process about the theme setting (native title bar overlay) on start and on change.
 */
export function useThemeSync(): void {
  const settings = useSettingsStore()
  watchEffect(() => applyDocumentTheme(settings.isDark, settings.settings.accent))
  watch(() => settings.settings.theme, syncWindowTheme, { immediate: true })
}
