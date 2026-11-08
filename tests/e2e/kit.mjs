/**
 * The e2e kit: everything a suite (tests/e2e/suites/*.mjs) or a suite helper (tests/e2e/lib/*)
 * imports. Import from this file only; the lib/ modules behind it may move.
 *
 * Inside a suite, prefer the context the runner passes to run(ctx): ctx.step, ctx.knownIssue,
 * ctx.launch (launchApp + console checks + cleanup), ctx.startBroker, ctx.rawClient and the
 * locator / screenshot helpers bound to the current app (ctx.click, ctx.capture…).
 * See tests/e2e/README.md.
 *
 * Safety (enforced by launchApp / spawnApp, not by convention): every launch gets MQTEY_E2E=1 and
 * a fresh MQTEY_USER_DATA_DIR, without ELECTRON_RUN_AS_NODE / ELECTRON_RENDERER_URL; dialogs,
 * shell calls and the clipboard are stubbed before the UI can use them; windows are kept off the
 * desktop and unfocused (checked after every step); every app is closed and its profile deleted.
 */

/** ROOT, OUT_DIR (MQTEY_E2E_OUT), MAIN, ARTIFACTS (MQTEY_E2E_ARTIFACTS), timeouts. */
export {
  ARTIFACTS,
  E2E_DIR,
  MAIN,
  OUT_DIR,
  ROOT,
  STEP_TIMEOUT,
  SUITES_DIR,
  TIMEOUT
} from './lib/paths.mjs'

/** Launches: launchApp (Playwright), spawnApp (expected to exit), profiles and seeds. */
export {
  automationEnv,
  createProfile,
  isKitProfile,
  launchApp,
  removeProfile,
  seedProfile,
  spawnApp
} from './lib/app.mjs'

/** Native stubs in main: dialogs, shell, app.relaunch, the clipboard module, Edit roles. */
export { clearNativeCalls, nativeCalls, nextDialogResult, stubNativeShell } from './lib/native.mjs'

/** The page's clipboard stub (window.__clip). */
export {
  clipboardText,
  clipboardWrites,
  setClipboardText,
  stubClipboard
} from './lib/clipboard.mjs'

/** The window: off the desktop, sizes, zoom, main-side capture. */
export {
  assertOffscreen,
  capturePage,
  setWindowSize,
  setZoom,
  windowPlacement
} from './lib/window.mjs'

/** An aedes broker (MQTT 3.1.1) and raw mqtt.js clients. */
export { freePort, rawClient, startBroker } from './lib/broker.mjs'

/** Locators, file-name slugs and the step machinery for helpers that run outside a suite. */
export { pageHelpers, slug, tid } from './lib/page.mjs'
export { sleep } from './lib/processes.mjs'
export { createSuite, SuiteAborted } from './lib/session.mjs'
