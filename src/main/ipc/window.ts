/**
 * `window.*` — native theme synchronisation.
 */
import { nativeTheme } from 'electron'
import { IPC } from '@shared/ipc'
import { applyThemeToAllWindows } from '../theme'
import type { RegisterHandler } from './handle'
import { parseThemeMode } from './validate'

/** Registers `window.setTheme` and follows OS theme changes. */
export function registerWindowIpc(register: RegisterHandler): void {
  register(IPC.windowSetTheme, (_ctx, mode) => {
    nativeTheme.themeSource = parseThemeMode(mode)
    applyThemeToAllWindows()
  })
  // The OS theme can change while `system` is selected.
  nativeTheme.on('updated', applyThemeToAllWindows)
}
