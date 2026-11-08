/**
 * check-package: the packaged smoke run. mqtt-in.exe starts in automation mode (MQTTIN_E2E=1 and a
 * fresh MQTTIN_USER_DATA_DIR; ELECTRON_RUN_AS_NODE and ELECTRON_RENDERER_URL removed), so its
 * window is an off-screen, unfocused tool window. The inspect fuse is off, so Playwright's
 * _electron cannot drive a packaged build: the app gets --remote-debugging-port and Playwright
 * attaches over CDP. The main process cannot be stubbed this way, so no step may open a native
 * dialog, the file manager or the browser.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Aedes } from 'aedes'
import { chromium } from 'playwright'
import { inspectWindows, onAnyDisplay } from './package-window.mjs'

const TIMEOUT = 20_000
const AUTOMATION_TITLE = 'mqtt-in (automation)'
const tid = (id, extra = '') => `[data-testid="${id}"]${extra}`
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function freePort() {
  const probe = createServer()
  await new Promise((done) => probe.listen(0, '127.0.0.1', done))
  const { port } = probe.address()
  await new Promise((done) => probe.close(done))
  return port
}

/** Automation mode on its own profile; refuses to return an environment without both. */
function automationEnv(profile) {
  const env = { ...process.env, MQTTIN_E2E: '1', MQTTIN_USER_DATA_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  if (env.MQTTIN_E2E !== '1' || !env.MQTTIN_USER_DATA_DIR) throw new Error('refusing to launch')
  return env
}

/** Records clipboard writes in the page instead of the system clipboard. */
function stubClipboard() {
  const clip = (globalThis.__clip = globalThis.__clip ?? [])
  const record = async (value) => void clip.push(value)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: record, write: record, readText: async () => '', read: async () => [] }
  })
}

async function waitForPage(port, exited) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && !exited()) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1000)
      })
      const targets = await response.json()
      if (targets.some((target) => target.type === 'page')) return true
    } catch {
      // DevTools endpoint not listening yet
    }
    await sleep(200)
  }
  return false
}

/** Connects through the UI, subscribes to '#', publishes and expects the message back. */
async function roundTrip(page, port) {
  const fill = (id, value) => page.locator(tid(id)).first().fill(value)
  const click = (id, extra) => page.locator(tid(id, extra)).first().click()
  const visible = (id, extra) => page.locator(tid(id, extra)).first().waitFor({ state: 'visible' })
  await click('sidebar-new-connection')
  await visible('connection-form')
  await fill('connection-name', 'Packaged smoke')
  await fill('connection-host', '127.0.0.1')
  await fill('connection-port', String(port))
  await click('connection-version-4') // aedes speaks MQTT 3.1.1
  await visible('connection-version-4', '[aria-pressed="true"]')
  await click('connection-save-connect')
  await visible('workspace-connect', '[data-status="connected"]')
  await click('subscription-add')
  await fill('subscription-topic', '#')
  await click('subscription-save')
  await visible('subscription-item', '[data-state="subscribed"]')
  await fill('publish-topic', 'package/smoke')
  await page.keyboard.press('Escape') // closes the topic suggestions
  await page.locator(tid('publish-payload', ' .cm-content')).first().click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('{"packaged": true}')
  await click('publish-button')
  for (const direction of ['out', 'in']) {
    await visible('message-row', `[data-topic="package/smoke"][data-direction="${direction}"]`)
  }
}

async function capture(page, artifacts, name) {
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  await page.mouse.move(1, 1)
  await page.screenshot({ path: join(artifacts, `${name}-${dark ? 'dark' : 'light'}.png`) })
}

async function toggleTheme(page) {
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  await page.locator(tid('theme-toggle')).first().click()
  await page.waitForFunction(
    (want) => document.documentElement.classList.contains('dark') === want,
    !dark
  )
  await sleep(250)
}

/** Runs the packaged app once; every result goes through `check`. Always cleans up. */
export async function smokeRun(exe, { check, artifacts, version }) {
  const profile = mkdtempSync(join(tmpdir(), 'mqtt-in-package-profile-'))
  const broker = await Aedes.createBroker()
  const server = createServer(broker.handle)
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const cdpPort = await freePort()
  const errors = []
  let child = null
  let browser = null
  let exitCode = null
  // Ctrl+C must not leave the packaged app running: end the process tree this run started.
  const interrupted = () => {
    if (child && exitCode === null) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    }
    process.exit(130)
  }
  process.once('SIGINT', interrupted)
  try {
    const started = Date.now()
    child = spawn(exe, [`--remote-debugging-port=${cdpPort}`], {
      cwd: dirname(exe),
      env: automationEnv(profile),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    child.stdout.resume()
    child.stderr.resume()
    child.on('exit', (code) => (exitCode = code ?? -1))
    const up = await waitForPage(cdpPort, () => exitCode !== null)
    if (!up) throw new Error(`no page on the DevTools port (exit code ${exitCode})`)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: TIMEOUT })
    const context = browser.contexts()[0]
    const page = context.pages().find((p) => p.url().startsWith('app://')) ?? context.pages()[0]
    page.setDefaultTimeout(TIMEOUT)
    await context.addInitScript(stubClipboard)
    await page.evaluate(stubClipboard)
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(`page error: ${error.message}`))
    await page.locator(tid('welcome')).first().waitFor({ state: 'visible', timeout: 30_000 })
    const welcomeMs = Date.now() - started
    // A full load with the listeners attached (they were not, during the first one).
    await page.reload()
    await page.locator(tid('welcome')).first().waitFor({ state: 'visible' })
    await sleep(500)
    check('welcome screen', true, `${welcomeMs} ms after spawn`)
    check(
      'served from app://mqtt-in/index.html',
      page.url().startsWith('app://mqtt-in/index.html'),
      page.url()
    )
    check('no console errors on a full load', errors.length === 0, errors.slice(0, 3).join(' | '))

    const facts = await page.evaluate(async () => {
      let file = 'readable'
      try {
        await fetch('file:///C:/Windows/win.ini')
      } catch (error) {
        file = `blocked (${error.message})`
      }
      const text = (id) => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
      return {
        origin: location.origin,
        file,
        credit: text('powered-by').replace(/\s+/g, ' ').trim(),
        statusbar: text('statusbar').replace(/\s+/g, ' '),
        info: await window.mqttIn.app.getInfo(),
        connections: (await window.mqttIn.connections.list()).length
      }
    })
    check(
      'origin app://mqtt-in, file:// unreachable',
      facts.origin === 'app://mqtt-in' && facts.file.startsWith('blocked'),
      `${facts.origin}; file:// ${facts.file}`
    )
    check(
      "'Powered by studiolab.id' on the welcome screen",
      facts.credit === 'Powered by studiolab.id',
      facts.credit
    )
    check(
      `status bar shows studiolab.id and v${version}`,
      facts.statusbar.includes('studiolab.id') && facts.statusbar.includes(`v${version}`),
      facts.statusbar.trim().slice(-60)
    )
    const isolated = facts.info.userDataPath.toLowerCase() === profile.toLowerCase()
    check(
      'app version and isolated profile',
      facts.info.version === version && isolated && facts.connections === 0,
      `v${facts.info.version}, ${facts.info.userDataPath}`
    )

    const { windows, displays } = await inspectWindows(child.pid)
    const shown = windows.filter((w) => w.visible)
    const win = shown[0]
    check(
      'one visible window: a tool window titled mqtt-in (automation)',
      shown.length === 1 && win.toolWindow && !win.appWindow && win.title === AUTOMATION_TITLE,
      shown.map((w) => `'${w.title}' tool=${w.toolWindow} app=${w.appWindow}`).join('; ')
    )
    // Win32's own answers (Playwright emulates page focus, so document.hasFocus() proves nothing).
    const rect = (r) => `${r.width}×${r.height} at ${r.x},${r.y}`
    const screens = `displays ${displays.map(rect).join(', ')}`
    check(
      'the window is off-screen and not the foreground window',
      Boolean(win) && !onAnyDisplay(win.bounds, displays) && !win.foreground,
      win ? `${rect(win.bounds)}${win.foreground ? ', FOREGROUND' : ''}; ${screens}` : 'no window'
    )

    await capture(page, artifacts, 'package-welcome')
    await toggleTheme(page)
    await capture(page, artifacts, 'package-welcome')
    await toggleTheme(page)

    errors.length = 0
    await roundTrip(page, server.address().port)
    check('MQTT round trip against aedes (publish out, receive in)', true)
    check(
      'no console errors during the round trip',
      errors.length === 0,
      errors.slice(0, 3).join(' | ')
    )
    await capture(page, artifacts, 'package-roundtrip')

    // Closing the window quits the app (disconnecting from the broker first).
    page.evaluate(() => window.close()).catch(() => undefined)
    for (let i = 0; i < 60 && exitCode === null; i++) await sleep(250)
    check(
      'the app exits with code 0 after its window closes',
      exitCode === 0,
      `exit code ${exitCode}`
    )
  } catch (error) {
    check(
      'packaged smoke run',
      false,
      String(error?.stack ?? error)
        .split('\n')
        .slice(0, 6)
        .join('\n')
    )
  } finally {
    process.off('SIGINT', interrupted)
    await browser?.close().catch(() => undefined)
    if (child && exitCode === null) {
      // Only the process tree this run started.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      for (let i = 0; i < 20 && exitCode === null; i++) await sleep(250)
    }
    await new Promise((done) => broker.close(done))
    await new Promise((done) => server.close(done))
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}
