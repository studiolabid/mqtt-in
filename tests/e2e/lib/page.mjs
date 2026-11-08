/**
 * Locator and screenshot helpers, bound to "the current page" of a suite (see session.mjs).
 * The UI is driven through data-testid hooks only.
 */
import { join } from 'node:path'
import { TIMEOUT } from './paths.mjs'
import { sleep } from './processes.mjs'

/** `[data-testid="<id>"]<extra>`, e.g. tid('message-row', '[data-direction="in"]'). */
export const tid = (id, extra = '') => `[data-testid="${id}"]${extra}`

/** 'Save and connect' → 'save-and-connect' (file names of FAILED / KNOWN screenshots). */
export const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')

/**
 * Helpers that act on `getPage()`.
 *
 * @param {() => import('playwright').Page} getPage
 * @param {{ dir: () => string, onShot: (file: string) => void }} shots
 */
export function pageHelpers(getPage, shots) {
  const page = () => getPage()
  const locate = (id, extra = '') => page().locator(tid(id, extra)).first()

  const waitForTestId = async (id, { extra = '', state = 'visible', timeout = TIMEOUT } = {}) => {
    await locate(id, extra).waitFor({ state, timeout })
    return locate(id, extra)
  }

  /** Clicks a hook, then parks the pointer so no tooltip or hover state leaks into screenshots. */
  const click = async (id, extra = '') => {
    await (await waitForTestId(id, { extra })).click()
    await page().mouse.move(1, 1)
  }

  const fill = async (id, value) => (await waitForTestId(id)).fill(value)

  /** Fails when a hook (e.g. a popover) is rendered outside the window. */
  const expectInViewport = async (id) => {
    const inside = await (
      await waitForTestId(id)
    ).evaluate((el) => {
      const box = el.getBoundingClientRect()
      return box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth
    })
    if (!inside) throw new Error(`${id} is rendered outside the window`)
  }

  const isDark = () => page().evaluate(() => document.documentElement.classList.contains('dark'))

  /** Waits until the theme class is applied and the frame settled. */
  const expectTheme = async (dark) => {
    await page().waitForFunction(
      (want) => document.documentElement.classList.contains('dark') === want,
      dark
    )
    await sleep(150)
  }

  /** `<artifacts>/<name>-<light|dark>.png` of the page as it is now. */
  const shot = async (name) => {
    const file = join(shots.dir(), `${name}-${(await isDark()) ? 'dark' : 'light'}.png`)
    await page().screenshot({ path: file, animations: 'disabled' })
    shots.onShot(file)
    return file
  }

  /** Flips the theme through the title bar toggle. */
  const toggleTheme = async () => {
    const dark = await isDark()
    await click('theme-toggle')
    await expectTheme(!dark)
  }

  /** Switches to the light (false) or dark (true) theme if needed. */
  const setTheme = async (dark) => {
    if ((await isDark()) !== dark) await toggleTheme()
  }

  /** Screenshot in both themes (through the title bar toggle); the theme is restored after. */
  const capture = async (name) => {
    await sleep(250)
    await shot(name)
    await toggleTheme()
    await shot(name)
    await toggleTheme()
  }

  const openModal = async (trigger, id) => {
    await click(trigger)
    await waitForTestId(id)
  }

  const pressEscapeUntilHidden = async (id) => {
    await page().keyboard.press('Escape')
    await waitForTestId(id, { state: 'hidden' })
  }

  /** Same for a modal, which covers the title bar: open, shoot, close (Esc), toggle, again. */
  const captureModal = async (name, trigger, id) => {
    for (let pass = 0; pass < 2; pass++) {
      await openModal(trigger, id)
      await sleep(250)
      await shot(name)
      await pressEscapeUntilHidden(id)
      await toggleTheme()
    }
  }

  return {
    locate,
    waitForTestId,
    click,
    fill,
    expectInViewport,
    isDark,
    expectTheme,
    shot,
    toggleTheme,
    setTheme,
    capture,
    openModal,
    pressEscapeUntilHidden,
    captureModal
  }
}
