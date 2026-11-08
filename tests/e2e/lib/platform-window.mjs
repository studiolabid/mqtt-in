/**
 * IN-01: what makes an automation window (MQTTIN_E2E=1) safe for the user's desktop, as a pure
 * decision function (`automationWindowProblems`, self-tested with fake values in the suite) and
 * the read-only collection of the real window's facts (`readWindowFacts`).
 */
import { nativeHandle, winStyle } from './platform.mjs'

/** Native title of an automation window (src/main/window-options.ts). */
export const AUTOMATION_TITLE = 'mqtt-in (automation)'

/** Keeps a window out of the taskbar, Alt+Tab and Task View. */
export const WS_EX_TOOLWINDOW = 0x80
/** Forces a window into the taskbar (and Alt+Tab). */
export const WS_EX_APPWINDOW = 0x40000
/** The window cannot be activated by a click (src/main/window-options.ts `focusable: false`). */
export const WS_EX_NOACTIVATE = 0x08000000

/** True when two { x, y, width, height } rectangles overlap. */
export const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

/**
 * Everything that would put the automation window in front of the user (empty: none).
 *
 * @param {object} facts
 * @param {string} facts.title the BrowserWindow title
 * @param {{ x: number, y: number, width: number, height: number }} facts.bounds DIP
 * @param {{ x: number, y: number, width: number, height: number }[]} facts.displays DIP
 * @param {boolean} facts.focused BrowserWindow.isFocused()
 * @param {boolean} [facts.devToolsOpened]
 * @param {number} [facts.windows] BrowserWindows of the app
 * @param {object} [facts.native] Windows: { exStyle, title, foreground } of the window's HWND
 * @param {object[]} [facts.processWindows] Windows: visible top-level windows of the main process
 * @param {string} [platform] default process.platform
 */
export function automationWindowProblems(facts, platform = process.platform) {
  const problems = []
  if (facts.title !== AUTOMATION_TITLE) {
    problems.push(`its title is "${facts.title}", not "${AUTOMATION_TITLE}"`)
  }
  const shown = (facts.displays ?? []).find((display) => overlaps(facts.bounds, display))
  if (shown) {
    problems.push(
      `its bounds ${JSON.stringify(facts.bounds)} overlap a display ${JSON.stringify(shown)}`
    )
  }
  if (facts.focused) problems.push('it has the focus')
  if (facts.devToolsOpened) problems.push('DevTools are open')
  if (facts.windows !== undefined && facts.windows !== 1) {
    problems.push(`the app has ${facts.windows} windows, not 1`)
  }
  if (platform !== 'win32') return problems
  const native = facts.native
  if (!native || typeof native.exStyle !== 'number') {
    problems.push('its extended window style could not be read')
    return problems
  }
  if ((native.exStyle & WS_EX_TOOLWINDOW) === 0) {
    problems.push(
      `WS_EX_TOOLWINDOW (0x80) is clear in 0x${native.exStyle.toString(16)}: it shows in the taskbar, Alt+Tab and Task View`
    )
  }
  if ((native.exStyle & WS_EX_APPWINDOW) !== 0) {
    problems.push(
      `WS_EX_APPWINDOW (0x40000) is set in 0x${native.exStyle.toString(16)}: it is forced into the taskbar`
    )
  }
  if (native.title !== undefined && native.title !== AUTOMATION_TITLE) {
    problems.push(`its native title is "${native.title}"`)
  }
  if (native.foreground) problems.push('it is the foreground window')
  const others = (facts.processWindows ?? []).filter((win) => win.hwnd !== native.hwnd)
  if (others.length > 0) {
    const list = others.map((win) => `"${win.title}" (${win.className})`).join(', ')
    problems.push(`the main process shows other windows: ${list}`)
  }
  return problems
}

/**
 * The first window's facts, read without changing anything (unlike the kit's windowPlacement,
 * nothing is moved or blurred): Electron's view, plus the native style on Windows.
 */
export async function readWindowFacts(app) {
  const main = await app.evaluate(({ BrowserWindow, screen }) => {
    const all = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
    const win = all[0]
    return {
      pid: process.pid,
      windows: all.length,
      title: win.getTitle(),
      bounds: win.getBounds(),
      displays: screen.getAllDisplays().map((display) => display.bounds),
      focused: win.isFocused(),
      visible: win.isVisible(),
      focusable: typeof win.isFocusable === 'function' ? win.isFocusable() : null,
      devToolsOpened: win.webContents.isDevToolsOpened()
    }
  })
  const hwnd = await nativeHandle(app)
  const report = await winStyle({ hwnd, pid: main.pid })
  return {
    ...main,
    hwnd,
    native: report?.window ?? null,
    processWindows: report?.processWindows ?? null,
    foregroundHwnd: report?.foregroundHwnd ?? null
  }
}

/** One line for the log: `0x…` style, flags, visibility. */
export function describeNative(native) {
  if (!native) return 'no native facts (not Windows)'
  const flags = ['toolWindow', 'appWindow', 'noActivate', 'topmost', 'visible', 'foreground']
    .map((flag) => `${flag}=${native[flag]}`)
    .join(' ')
  return `exStyle=0x${native.exStyle.toString(16)} ${flags} rect=${JSON.stringify(native.rect)}`
}
