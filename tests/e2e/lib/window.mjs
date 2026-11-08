/**
 * The automation window stays off the desktop: it sits left of every display (MQTEY_E2E=1) and
 * must never take the focus. Resize it only through setWindowSize: a plain setContentSize grows
 * the window to the right, onto the displays.
 */
import { writeFileSync } from 'node:fs'
import { sleep, within } from './processes.mjs'

/** Gap between the window and the leftmost display (as the app's own offscreenBounds). */
const GAP = 200

/**
 * Every window of the app: { title, bounds, visible, focused, onScreen }. A window found on a
 * display is moved off it right away, and a focused one is blurred (Windows then activates the
 * next window down, normally the user's); both are still reported (onScreen / focused: true).
 */
export function windowPlacement(app) {
  return app.evaluate(({ BrowserWindow, screen }, gap) => {
    const displays = screen.getAllDisplays().map((display) => display.bounds)
    const left = Math.min(...displays.map((display) => display.x))
    const top = Math.min(...displays.map((display) => display.y))
    const hits = (a, b) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    return BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map((win) => {
        const bounds = win.getBounds()
        const onScreen = displays.some((display) => hits(bounds, display))
        if (onScreen) win.setPosition(left - bounds.width - gap, top)
        const focused = win.isFocused()
        if (focused) win.blur()
        const visible = win.isVisible()
        return { title: win.getTitle(), bounds, visible, focused, onScreen }
      })
  }, GAP)
}

/**
 * Throws when a visible window was on a display (it is moved off first) or has the focus. An app
 * that is gone (or a main process that does not answer within 10 s) has no window to check.
 */
export async function assertOffscreen(app) {
  const windows = await within(windowPlacement(app), 10_000, [])
  const shown = windows.filter((win) => win.visible && win.onScreen)
  if (shown.length > 0) {
    throw new Error(`a window was on the desktop (moved off): ${JSON.stringify(shown[0].bounds)}`)
  }
  const focused = windows.find((win) => win.focused)
  if (focused) throw new Error(`the window "${focused.title}" took the focus (blurred)`)
}

/**
 * Sets the first window's content (viewport) size, keeping the window left of every display:
 * each change is one setBounds call placed from the leftmost display, so it never crosses one.
 * Resolves the real content size. The window minimum is 960 × 600; the frameless window then
 * reports a 976 × 608 content area, which is the smallest viewport a user can get too.
 */
export async function setWindowSize(app, width, height) {
  const result = await app.evaluate(
    ({ BrowserWindow, screen }, { size, gap }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const displays = screen.getAllDisplays().map((display) => display.bounds)
      const left = Math.min(...displays.map((display) => display.x))
      const top = Math.min(...displays.map((display) => display.y))
      const [minWidth, minHeight] = win.getMinimumSize()
      // Window and content differ by a frame that only shows after the first resize: converge.
      for (let pass = 0; pass < 3; pass++) {
        const [contentWidth, contentHeight] = win.getContentSize()
        if (contentWidth === size.width && contentHeight === size.height) break
        const outer = win.getBounds()
        const w = Math.max(outer.width + size.width - contentWidth, minWidth)
        const h = Math.max(outer.height + size.height - contentHeight, minHeight)
        if (pass > 0 && w === outer.width && h === outer.height) break // at the minimum
        win.setBounds({ x: left - w - gap, y: top, width: w, height: h })
      }
      const [contentWidth, contentHeight] = win.getContentSize()
      return { width: contentWidth, height: contentHeight }
    },
    { size: { width, height }, gap: GAP }
  )
  await assertOffscreen(app)
  await sleep(250)
  return result
}

/** Sets the zoom factor of the first window (CSS px shrink as the factor grows). */
export async function setZoom(app, factor) {
  await app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value)
  }, factor)
  await sleep(400)
}

/**
 * Captures the first window through main (webContents.capturePage) into `file`. Unlike
 * page.screenshot it is right at any zoom factor, and it works while Playwright's page is gone
 * (e.g. after a renderer crash).
 */
export async function capturePage(app, file) {
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    return image.toPNG().toString('base64')
  })
  writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}
