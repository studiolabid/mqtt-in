/**
 * Helpers of the platform suites (tests/e2e/suites/platform-*.mjs):
 * - the native side of the window (handle, style bits, the foreground window) through the
 *   read-only tests/e2e/win-style.ps1;
 * - page evaluation through the main process that never hangs (after a renderer crash or a
 *   blocked navigation, Playwright's page may wait forever);
 * - polling, seeded connection profiles, sessions, log rows, the main log.
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { E2E_DIR, sleep, tid } from '../kit.mjs'

const WIN_STYLE = join(E2E_DIR, 'win-style.ps1')

/**
 * Polls `probe` until it returns a truthy value (returned) or `timeout` ms pass (throws with the
 * last value). A probe that throws counts as falsy.
 */
export async function waitFor(
  probe,
  { timeout = 15_000, interval = 100, label = 'condition' } = {}
) {
  const until = Date.now() + timeout
  let last
  for (;;) {
    try {
      last = await probe()
      if (last) return last
    } catch (error) {
      last = `threw: ${String(error?.message ?? error).split('\n')[0]}`
    }
    if (Date.now() > until) {
      throw new Error(
        `timed out after ${timeout} ms waiting for ${label} (last: ${JSON.stringify(last)})`
      )
    }
    await sleep(interval)
  }
}

/**
 * Runs `code` (a JS expression) in the first window's page through main. Never hangs: a crashed or
 * loading page answers 'not ready', a page that does not answer within `timeout` 'timeout'.
 * Resolves `{ ready: true, value }` or `{ ready: false, reason }`.
 */
export function inPage(app, code, { timeout = 2_000 } = {}) {
  return app.evaluate(
    async ({ BrowserWindow }, { js, ms }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win || win.isDestroyed()) return { ready: false, reason: 'no window' }
      const contents = win.webContents
      if (contents.isCrashed() || contents.isLoading()) return { ready: false, reason: 'not ready' }
      let timer
      const late = new Promise((done) => {
        timer = setTimeout(() => done({ ready: false, reason: 'timeout' }), ms)
      })
      try {
        const run = contents.executeJavaScript(js).then((value) => ({ ready: true, value }))
        return await Promise.race([run, late])
      } catch (error) {
        return { ready: false, reason: `error: ${error.message}` }
      } finally {
        clearTimeout(timer)
      }
    },
    { js: code, ms: timeout }
  )
}

/** The first window's native handle (HWND on Windows) as a decimal string. */
export function nativeHandle(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const buffer = BrowserWindow.getAllWindows()[0].getNativeWindowHandle()
    const value = buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0))
    return value.toString()
  })
}

/**
 * Windows only (null elsewhere): read-only native facts from win-style.ps1 —
 * `{ foregroundHwnd, window, processWindows }` for `hwnd` and / or the process `pid`.
 */
export function winStyle({ hwnd = '', pid = 0 } = {}) {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WIN_STYLE]
  if (hwnd) args.push('-Hwnd', String(hwnd))
  if (pid) args.push('-ProcessId', String(pid))
  return new Promise((done, fail) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 60_000 }, (error, out, err) => {
      if (error) return fail(new Error(`win-style.ps1 failed: ${err || error.message}`))
      try {
        done(JSON.parse(out.trim()))
      } catch {
        fail(new Error(`win-style.ps1 printed no JSON: ${out.slice(0, 200)}`))
      }
    })
  })
}

/** A connection profile for seeding data/connections.json (the app fills the other fields). */
export function connectionProfile(overrides) {
  return {
    name: overrides.id,
    host: '127.0.0.1',
    port: 1883,
    protocol: 'mqtt',
    protocolVersion: 4,
    clientId: `e2e-${overrides.id}`,
    autoReconnect: true,
    reconnectPeriod: 1_000,
    subscriptions: [],
    ...overrides
  }
}

/** A launchApp seed with these saved connections. */
export const seedConnections = (profiles) => ({
  'data/connections.json': { version: 1, connections: profiles }
})

/** The main process' session snapshots (through the page's bridge). */
export const sessions = (page) => page.evaluate(() => window.mqtey.mqtt.getSessions())

/** Waits until the session of `id` matches `predicate`; resolves the snapshot. */
export function waitSession(page, id, predicate, { timeout = 15_000, label } = {}) {
  return waitFor(
    async () => {
      const session = (await sessions(page)).find((entry) => entry.connectionId === id)
      return session && predicate(session) ? session : null
    },
    { timeout, label: label ?? `the session of ${id}` }
  )
}

/** Opens the workspace of connection `id` (hash route) and waits for its header. */
export async function openWorkspace(page, id) {
  await page.evaluate((connectionId) => {
    location.hash = `#/connections/${connectionId}`
  }, id)
  await page.locator(tid('workspace-connect')).first().waitFor({ timeout: 15_000 })
}

/** The workspace status button's data-status ('connected', 'error'…), or null. */
export const workspaceStatus = (page) =>
  page
    .locator(tid('workspace-connect'))
    .first()
    .getAttribute('data-status', { timeout: 5_000 })
    .catch(() => null)

/** The rendered log rows of the open Logs tab: `{ level, text }`. */
export const logRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="log-row"]')].map((row) => ({
      level: row.getAttribute('data-level'),
      text: (row.textContent ?? '').replace(/\s+/g, ' ').trim()
    }))
  )

/** `<profile>/logs/main.log` of a launch handle ('' when there is none). */
export const mainLog = (handle) => handle.readFile('logs/main.log') ?? ''

/** The visible toast whose text contains `text`. */
export const toast = (page, text) => page.locator('[data-sonner-toast]', { hasText: text }).first()

/** Fails with `message` (plus the details) unless `condition` holds. */
export function expect(condition, message, details) {
  if (condition) return
  const suffix =
    details === undefined
      ? ''
      : `: ${typeof details === 'string' ? details : JSON.stringify(details)}`
  throw new Error(`${message}${suffix}`)
}
