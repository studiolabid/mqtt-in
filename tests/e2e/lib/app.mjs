/**
 * Launching the built app. Enforced here for every launch:
 * - MQTTIN_E2E=1 (an off-screen tool window that never takes focus) and MQTTIN_USER_DATA_DIR=<a
 *   fresh temporary profile created by this kit>; ELECTRON_RUN_AS_NODE and ELECTRON_RENDERER_URL
 *   removed. A caller cannot override or remove them;
 * - native dialogs, the shell and the clipboard are stubbed before the UI can use them;
 * - the app is closed (or its own process tree killed) and its profile deleted.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'
import { stubClipboard, stubClipboardFromMain } from './clipboard.mjs'
import { stubNativeShell } from './native.mjs'
import { MAIN, OUT_DIR, ROOT, TIMEOUT } from './paths.mjs'
import { isRunning, killTree, sleep, waitForExit } from './processes.mjs'
import { assertOffscreen, setWindowSize } from './window.mjs'

const KIT_ENV = [
  'MQTTIN_E2E',
  'MQTTIN_USER_DATA_DIR',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL'
]
const QUIET_STDERR = /Debugger (listening|attached|ending)|For help, see/
const CONTAIN_PROFILE = join(dirname(fileURLToPath(import.meta.url)), 'contain-profile.cjs')

/** Profiles this kit created and has not deleted yet. */
const profiles = new Map()
/** Every profile this run created (for the leak check). */
export const createdProfiles = []
/** Every app process this run started (for the leak check): { pid, script, child }. */
export const startedApps = []
/** Apps that are open now. */
export const openApps = new Set()

const keyOf = (dir) => (process.platform === 'win32' ? resolve(dir).toLowerCase() : resolve(dir))
const slugTag = (tag) =>
  String(tag)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 24)

/** A fresh, empty profile folder in the OS temp folder. */
export function createProfile(tag = 'app') {
  const dir = mkdtempSync(join(tmpdir(), `mqtt-in-e2e-${slugTag(tag)}-`))
  profiles.set(keyOf(dir), dir)
  createdProfiles.push(dir)
  return dir
}

export const isKitProfile = (dir) => typeof dir === 'string' && profiles.has(keyOf(dir))

/** Every profile created by this run that still exists. */
export const kitProfiles = () => [...profiles.values()]

/** Deletes a kit profile; false when it could not be deleted (a process still holds it). */
export function removeProfile(dir) {
  if (!isKitProfile(dir)) return true
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    profiles.delete(keyOf(dir))
    return true
  } catch {
    return false
  }
}

/**
 * Writes files into a profile before a launch: an object { 'data/connections.json': content }
 * (a string, a Buffer, or any other value written as JSON), or a function (profileDir) => void.
 */
export async function seedProfile(dir, seed) {
  if (!isKitProfile(dir)) throw new Error(`not a profile created by the e2e kit: ${dir}`)
  if (typeof seed === 'function') return void (await seed(dir))
  for (const [path, content] of Object.entries(seed ?? {})) {
    const target = resolve(dir, path)
    const inside = relative(dir, target)
    if (isAbsolute(path) || !inside || inside.startsWith('..') || isAbsolute(inside)) {
      throw new Error(`seed path must stay inside the profile: ${path}`)
    }
    mkdirSync(dirname(target), { recursive: true })
    const raw = typeof content === 'string' || content instanceof Uint8Array
    writeFileSync(target, raw ? content : JSON.stringify(content, null, 2))
  }
}

/** The environment of a launch: the shell's plus `extra`, with the kit's variables forced. */
export function automationEnv(userData, extra = {}) {
  if (!isKitProfile(userData)) throw new Error(`not a profile created by the e2e kit: ${userData}`)
  for (const key of Object.keys(extra)) {
    if (KIT_ENV.includes(key.toUpperCase())) throw new Error(`launch env: the kit sets ${key}`)
  }
  const env = { ...process.env, ...extra }
  for (const key of Object.keys(env)) {
    // Windows variable names ignore case: drop every spelling.
    if (KIT_ENV.includes(key.toUpperCase()) || env[key] === undefined) delete env[key]
  }
  env.MQTTIN_E2E = '1'
  env.MQTTIN_USER_DATA_DIR = userData
  return env
}

function checkEntry(entry) {
  if (!existsSync(entry)) {
    const hint = entry === MAIN ? `: run "npx electron-vite build --outDir ${OUT_DIR}" first` : ''
    throw new Error(`${entry} is missing${hint}`)
  }
}

function profileFor(reuse, tag) {
  if (reuse === undefined) return createProfile(tag)
  if (!isKitProfile(reuse)) throw new Error(`userData must be a kit profile: ${reuse}`)
  if ([...openApps].some((open) => keyOf(open.userData) === keyOf(reuse))) {
    throw new Error('that profile is in use by an open app (close it with keepProfile first)')
  }
  return reuse
}

/**
 * Launches the built app with Playwright in automation mode and waits for its first window.
 *
 * @param {object} [options]
 * @param {object|Function} [options.seed] files to write into the profile first (seedProfile)
 * @param {object} [options.env] extra environment variables (not the kit's own four)
 * @param {string[]} [options.args] extra arguments after the entry
 * @param {{ width: number, height: number }} [options.size] content size (kept off-screen)
 * @param {string} [options.userData] a kit profile to reuse (after close({ keepProfile: true }))
 * @param {string} [options.entry] the script or folder Electron starts (default: MAIN)
 * @param {string|null} [options.ready] data-testid to wait for (default 'titlebar'; null: none)
 * @param {boolean} [options.echo] print main-process stderr (default true)
 * @param {Function} [options.onConsole] ({ kind: 'error'|'pageerror'|'warning', text }) => void
 * @param {(line: string) => void} [options.log] where echoed lines go (default stderr)
 */
export async function launchApp(options = {}) {
  const { seed, env, args = [], size, entry = MAIN, ready = 'titlebar', echo = true } = options
  checkEntry(entry)
  const userData = profileFor(options.userData, options.tag ?? 'app')
  const output = []
  const handle = {
    app: null,
    page: null,
    /** The Electron main process. */
    pid: 0,
    /** The process Playwright started (cmd.exe on Windows, else the same as pid). */
    launcherPid: 0,
    userData,
    errors: [],
    warnings: [],
    closed: false
  }
  handle.output = () => output.join('')
  handle.readFile = (path) => {
    const file = resolve(userData, path)
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  }
  let closing = null
  handle.close = ({ keepProfile = false, timeout = 15_000 } = {}) => {
    closing ??= (async () => {
      const child = handle.app?.process()
      if (handle.app) {
        await Promise.race([handle.app.close().catch(() => undefined), sleep(timeout)])
      }
      const killed = isRunning(child) && killTree(child)
      if (killed) await waitForExit(child, 5_000)
      openApps.delete(handle)
      handle.closed = true
      const removed = keepProfile || removeProfile(userData)
      return { killed, removed }
    })()
    return closing
  }
  const report = (kind, text) => {
    if (kind === 'warning') handle.warnings.push(text)
    else handle.errors.push(text)
    options.onConsole?.({ kind, text })
  }
  try {
    await seedProfile(userData, seed)
    const app = await electron.launch({
      args: [entry, ...args],
      env: automationEnv(userData, env),
      cwd: ROOT,
      timeout: 30_000
    })
    // On Windows Playwright starts Electron through `cmd.exe /c`: app.process() is that launcher
    // (its tree is what killTree stops), the Electron main process is its child.
    const launcherPid = app.process().pid
    const pid = await app.evaluate(() => process.pid).catch(() => launcherPid)
    Object.assign(handle, { app, pid, launcherPid })
    openApps.add(handle)
    startedApps.push({ pid, script: entry, child: app.process() })
    app.process().stdout?.on('data', (data) => output.push(String(data)))
    app.process().stderr?.on('data', (data) => {
      output.push(String(data))
      if (echo && !QUIET_STDERR.test(String(data))) {
        const line = `    [main] ${String(data).trimEnd()}`
        if (options.log) options.log(line)
        else process.stderr.write(`${line}\n`)
      }
    })
    // On the context, so messages of the first page load are not missed.
    const context = app.context()
    context.on('console', (message) => {
      const type = message.type()
      if (type !== 'error' && type !== 'warning') return
      report(type, `${message.text()} (${message.location().url ?? ''})`)
    })
    context.on('weberror', (error) => report('pageerror', `page error: ${error.error().message}`))
    await stubNativeShell(app)
    await stubClipboardFromMain(app)
    handle.page = await app.firstWindow({ timeout: 30_000 })
    handle.page.setDefaultTimeout(TIMEOUT)
    await assertOffscreen(app)
    if (size) await setWindowSize(app, size.width, size.height)
    if (ready) {
      await handle.page.locator(`[data-testid="${ready}"]`).first().waitFor({ timeout: 30_000 })
    }
    // Before any copy can happen (the app copies on user actions only).
    await stubClipboard(handle.page)
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

/**
 * Starts the built app as a plain process and waits for it to exit: for launches that are
 * expected to quit (a second instance, the profile guard). Kills its own process tree after
 * `timeout`. Resolves { code, signal, stdout, stderr, ms, timedOut, pid, userData }.
 *
 * @param {object} [options]
 * @param {string} [options.userData] a kit profile, e.g. the one of an open launchApp handle
 *   (second instance); default: a fresh profile, deleted afterwards (unless keepProfile)
 * @param {boolean} [options.simulateMissingProfile] hide MQTTIN_USER_DATA_DIR from the app (see
 *   contain-profile.cjs: the profile stays contained even if the guard is broken)
 */
export async function spawnApp(options = {}) {
  const { seed, env, args = [], entry = MAIN, timeout = 15_000, keepProfile = false } = options
  checkEntry(entry)
  const reused = options.userData !== undefined
  if (reused && !isKitProfile(options.userData)) {
    throw new Error(`userData must be a kit profile: ${options.userData}`)
  }
  const userData = reused ? options.userData : createProfile(options.tag ?? 'spawn')
  try {
    await seedProfile(userData, seed)
    const childEnv = automationEnv(userData, env)
    const preload = options.simulateMissingProfile ? ['-r', CONTAIN_PROFILE] : []
    const started = Date.now()
    const child = spawn(electronPath, [...preload, entry, ...args], {
      cwd: ROOT,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    startedApps.push({ pid: child.pid, script: entry, child })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => (stdout += data))
    child.stderr.on('data', (data) => (stderr += data))
    const closed = new Promise((done) => child.once('close', done))
    const failed = new Promise((done) => child.once('error', done))
    const exited = await Promise.race([waitForExit(child, timeout), failed.then(() => true)])
    if (!exited || isRunning(child)) {
      killTree(child)
      await waitForExit(child, 5_000)
    }
    // The rest of stdout / stderr (a leftover child process could keep the pipes open).
    await Promise.race([closed, sleep(1_000)])
    return {
      code: child.exitCode,
      signal: child.signalCode,
      stdout,
      stderr,
      ms: Date.now() - started,
      timedOut: !exited,
      pid: child.pid,
      userData
    }
  } finally {
    if (!reused && !keepProfile) removeProfile(userData)
  }
}
