/**
 * The application menu template (`Menu.buildFromTemplate` is mocked to return it): zoom works
 * with Ctrl+= and the numeric keypad through hidden items, and development items stay out of
 * production menus.
 */
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { buildAppMenu } from '../../../src/main/menu'

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => template }
}))

type Item = MenuItemConstructorOptions

function template(isDev: boolean, platform: NodeJS.Platform = 'win32'): Item[] {
  return buildAppMenu(isDev, platform) as unknown as Item[]
}

function submenu(items: Item[], label: string): Item[] {
  const menu = items.find((item) => item.label === label)
  if (!menu || !Array.isArray(menu.submenu)) throw new Error(`No ${label} menu`)
  return menu.submenu
}

describe('buildAppMenu', () => {
  it('zooms in with Ctrl+= through a hidden item (no Shift on US layouts)', () => {
    const view = submenu(template(false), 'View')
    const alias = view.find(
      (item) => item.role === 'zoomIn' && item.accelerator === 'CommandOrControl+='
    )
    expect(alias).toBeDefined()
    expect(alias?.visible).toBe(false)
  })

  it('zooms with the numeric keypad through hidden items', () => {
    const view = submenu(template(false), 'View')
    const hidden = view.filter((item) => item.visible === false)
    expect(hidden.map((item) => [item.role, item.accelerator])).toEqual([
      ['zoomIn', 'CommandOrControl+='],
      ['zoomIn', 'CommandOrControl+numadd'],
      ['zoomOut', 'CommandOrControl+numsub'],
      ['resetZoom', 'CommandOrControl+num0']
    ])
  })

  it('keeps one visible entry per zoom command, with the roles’ own accelerators', () => {
    const view = submenu(template(false), 'View')
    const visible = view.filter((item) => item.visible !== false && item.role)
    expect(visible.map((item) => item.role)).toEqual([
      'resetZoom',
      'zoomIn',
      'zoomOut',
      'togglefullscreen'
    ])
    expect(visible.every((item) => item.accelerator === undefined)).toBe(true)
  })

  it('adds reload and DevTools in development only', () => {
    const roles = (isDev: boolean): unknown[] =>
      submenu(template(isDev), 'View').map((item) => item.role)
    expect(roles(true)).toEqual(expect.arrayContaining(['reload', 'toggleDevTools']))
    expect(roles(false)).not.toContain('reload')
    expect(roles(false)).not.toContain('toggleDevTools')
  })

  it('has the macOS app menu on macOS only', () => {
    expect(template(false, 'darwin')[0].role).toBe('appMenu')
    expect(template(false, 'win32').some((item) => item.role === 'appMenu')).toBe(false)
  })

  it('builds a fresh template every time (the hidden items are not shared objects)', () => {
    const first = submenu(template(false), 'View').filter((item) => item.visible === false)
    const second = submenu(template(false), 'View').filter((item) => item.visible === false)
    expect(first).toEqual(second)
    expect(first[0]).not.toBe(second[0])
  })
})
