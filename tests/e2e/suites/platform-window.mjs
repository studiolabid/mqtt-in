/**
 * IN-01: the automation window (MQTTIN_E2E=1) stays off the user's desktop: outside every display,
 * never focused, titled 'mqtt-in (automation)', and on Windows a tool window (WS_EX_TOOLWINDOW set,
 * WS_EX_APPWINDOW clear: no taskbar, Alt+Tab or Task View entry) with no other visible window of
 * the main process (no DevTools, no native dialog). Everything is read, nothing is moved or
 * focused; the decision function is first proven to reject unsafe values (fake data, no window).
 */
import { nativeCalls, setWindowSize } from '../kit.mjs'
import { expect } from '../lib/platform.mjs'
import {
  AUTOMATION_TITLE,
  automationWindowProblems,
  describeNative,
  readWindowFacts,
  WS_EX_APPWINDOW,
  WS_EX_NOACTIVATE,
  WS_EX_TOOLWINDOW
} from '../lib/platform-window.mjs'

/** A safe automation window, as the decision function sees it (fake values). */
const SAFE = {
  title: AUTOMATION_TITLE,
  bounds: { x: -1500, y: 0, width: 1280, height: 800 },
  displays: [{ x: 0, y: 0, width: 1920, height: 1080 }],
  focused: false,
  devToolsOpened: false,
  windows: 1,
  native: {
    hwnd: '42',
    exStyle: WS_EX_TOOLWINDOW | 0x100,
    title: AUTOMATION_TITLE,
    foreground: false
  },
  processWindows: [{ hwnd: '42', title: AUTOMATION_TITLE, className: 'Chrome_WidgetWin_1' }]
}

/** Unsafe variants and the problem each must produce. */
const UNSAFE = [
  [
    'a normal app window (WS_EX_WINDOWEDGE only)',
    { native: { ...SAFE.native, exStyle: 0x100 } },
    /WS_EX_TOOLWINDOW/
  ],
  [
    'WS_EX_APPWINDOW set',
    { native: { ...SAFE.native, exStyle: SAFE.native.exStyle | WS_EX_APPWINDOW } },
    /WS_EX_APPWINDOW/
  ],
  ['the plain app title', { title: 'mqtt-in' }, /title is "mqtt-in"/],
  [
    'bounds on a display',
    { bounds: { x: 100, y: 100, width: 1280, height: 800 } },
    /overlap a display/
  ],
  [
    'partly on a display',
    { bounds: { x: -1279, y: 0, width: 1280, height: 800 } },
    /overlap a display/
  ],
  ['focused', { focused: true }, /has the focus/],
  ['the foreground window', { native: { ...SAFE.native, foreground: true } }, /foreground window/],
  [
    'a second visible window',
    {
      processWindows: [
        ...SAFE.processWindows,
        { hwnd: '7', title: 'DevTools', className: 'Chrome_WidgetWin_1' }
      ]
    },
    /other windows/
  ],
  ['two app windows', { windows: 2 }, /2 windows/],
  ['DevTools open', { devToolsOpened: true }, /DevTools/],
  ['no style read', { native: null }, /could not be read/]
]

export default {
  name: 'platform-window',
  order: 20,

  async run(ctx) {
    const { step, log } = ctx

    await step('the decision function rejects unsafe windows (fake values)', async () => {
      const safe = automationWindowProblems(SAFE, 'win32')
      expect(safe.length === 0, 'a safe window was rejected', safe)
      for (const [label, change, problem] of UNSAFE) {
        const problems = automationWindowProblems({ ...SAFE, ...change }, 'win32')
        expect(
          problems.some((text) => problem.test(text)),
          `"${label}" was not rejected with ${problem}`,
          problems
        )
      }
      // Other platforms have no style bits: the rest still applies.
      const linux = automationWindowProblems({ ...SAFE, native: undefined }, 'linux')
      expect(linux.length === 0, 'a safe non-Windows window was rejected', linux)
      expect(
        automationWindowProblems({ ...SAFE, focused: true }, 'linux').length === 1,
        'a focused non-Windows window was accepted'
      )
      log(`${UNSAFE.length} unsafe variants rejected`)
    })

    await step('launch the app', async () => {
      await ctx.launch()
      await ctx.waitForTestId('welcome', { timeout: 30_000 })
    })

    await step('the automation window stays off the desktop', async () => {
      const facts = await readWindowFacts(ctx.app)
      log(`bounds ${JSON.stringify(facts.bounds)}, displays ${JSON.stringify(facts.displays)}`)
      log(`visible=${facts.visible} focused=${facts.focused} focusable=${facts.focusable}`)
      log(describeNative(facts.native))
      const problems = automationWindowProblems(facts)
      expect(problems.length === 0, 'the automation window is not safe', problems)
      if (process.platform === 'win32') {
        expect(
          facts.foregroundHwnd !== facts.hwnd,
          'the automation window is the foreground window'
        )
      }
      const dialogs = (await nativeCalls(ctx.app)).filter((call) => call.name.startsWith('dialog.'))
      expect(dialogs.length === 0, 'a native dialog was requested', dialogs)
    })

    await step('it stays off the desktop after a resize and a theme change', async () => {
      await setWindowSize(ctx.app, 1280, 800)
      await ctx.toggleTheme()
      await ctx.shot('window-welcome')
      await ctx.toggleTheme()
      const problems = automationWindowProblems(await readWindowFacts(ctx.app))
      expect(problems.length === 0, 'the automation window is not safe any more', problems)
    })

    // A renderer crash re-focuses the web contents, which activates the window (the user's
    // keystrokes then go to it). Fixed by `focusable: false` (WS_EX_NOACTIVATE) for automation
    // windows in src/main/window-options.ts; platform-crash waits for the same fix.
    await ctx.knownIssue(
      'the automation window cannot be activated',
      'automation windows are focusable (hand-off to final: window-options.ts focusable: false)',
      async () => {
        const facts = await readWindowFacts(ctx.app)
        expect(facts.focusable === false, 'BrowserWindow.isFocusable() is true')
        if (process.platform === 'win32') {
          expect(
            (facts.native.exStyle & WS_EX_NOACTIVATE) !== 0,
            `WS_EX_NOACTIVATE is clear in 0x${facts.native.exStyle.toString(16)}`
          )
        }
      }
    )
  }
}
