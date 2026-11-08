/**
 * Native window colors that follow the app theme (background, title-bar overlay).
 */
import { BrowserWindow, nativeTheme, type TitleBarOverlayOptions } from 'electron'
import type { ThemeMode } from '@shared/models'

/** Height of the custom title bar (matches the renderer's header). */
export const TITLE_BAR_HEIGHT = 40

const COLORS = {
  dark: { background: '#09090b', symbol: '#e4e4e7' },
  light: { background: '#ffffff', symbol: '#3f3f46' }
} as const

/** Windows and Linux draw native window controls over our title bar. */
export function usesTitleBarOverlay(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' || platform === 'linux'
}

/** Whether `mode` resolves to dark (`system` follows the OS). */
export function isDarkMode(mode: ThemeMode, systemDark = nativeTheme.shouldUseDarkColors): boolean {
  return mode === 'system' ? systemDark : mode === 'dark'
}

/** Window background matching the renderer background (no flash while loading). */
export function backgroundColor(dark: boolean): string {
  return dark ? COLORS.dark.background : COLORS.light.background
}

/** Transparent overlay whose window-control symbols contrast with the theme. */
export function titleBarOverlay(dark: boolean): TitleBarOverlayOptions {
  return {
    color: '#00000000',
    symbolColor: dark ? COLORS.dark.symbol : COLORS.light.symbol,
    height: TITLE_BAR_HEIGHT
  }
}

/** Re-applies the native colors of `win` from `nativeTheme.shouldUseDarkColors`. */
export function applyWindowTheme(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const dark = nativeTheme.shouldUseDarkColors
  win.setBackgroundColor(backgroundColor(dark))
  if (!usesTitleBarOverlay()) return
  try {
    win.setTitleBarOverlay(titleBarOverlay(dark))
  } catch (err) {
    console.warn('[window] Cannot update the title bar overlay:', err)
  }
}

/** Re-applies the native colors of every open window. */
export function applyThemeToAllWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) applyWindowTheme(win)
}
