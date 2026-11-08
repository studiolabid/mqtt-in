/**
 * Minimal application menu: standard edit / view / window roles (their accelerators work
 * even though the title bar is custom and the menu bar hidden). Reload and DevTools are
 * development-only.
 *
 * Zoom: the roles' own accelerators are Ctrl+Plus (Shift+= on US layouts), Ctrl+- and Ctrl+0.
 * Hidden duplicates add the keys people actually press: Ctrl+= and the numeric keypad's
 * + / - / 0 (macOS: Cmd). The renderer lists them in its shortcut sheets (`SHORTCUTS.zoomIn`…).
 */
import { Menu, type MenuItemConstructorOptions } from 'electron'

/** Extra, invisible zoom accelerators (see the module comment). */
export const ZOOM_ALIASES: readonly MenuItemConstructorOptions[] = [
  { role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false },
  { role: 'zoomIn', accelerator: 'CommandOrControl+numadd', visible: false },
  { role: 'zoomOut', accelerator: 'CommandOrControl+numsub', visible: false },
  { role: 'resetZoom', accelerator: 'CommandOrControl+num0', visible: false }
]

/** The application menu (macOS app menu, Edit, View, Window). */
export function buildAppMenu(isDev: boolean, platform: NodeJS.Platform = process.platform): Menu {
  const devItems: MenuItemConstructorOptions[] = isDev
    ? [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }]
    : []
  const template: MenuItemConstructorOptions[] = [
    ...(platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...devItems,
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...ZOOM_ALIASES.map((item) => ({ ...item })),
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ]
  return Menu.buildFromTemplate(template)
}
