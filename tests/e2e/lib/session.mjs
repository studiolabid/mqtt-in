/**
 * One suite's context (`ctx`): the step runner (fail-fast), console / page error checks with
 * per-step allow-lists, known issues, the suite's apps, brokers and clients (all closed at the
 * end), and the locator / screenshot helpers bound to the current app's page.
 */
import { join } from 'node:path'
import { kitProfiles, launchApp, removeProfile } from './app.mjs'
import { rawClient, startBroker } from './broker.mjs'
import { pageHelpers, slug, tid } from './page.mjs'
import { STEP_TIMEOUT } from './paths.mjs'
import { sleep, within } from './processes.mjs'
import { assertOffscreen, capturePage } from './window.mjs'

/** Thrown by step() after a failure: the suite stops there (the runner has the details). */
export class SuiteAborted extends Error {}

const matches = (pattern, text) =>
  pattern instanceof RegExp ? pattern.test(text) : text.includes(String(pattern))
const firstLine = (error) => String(error?.message ?? error).split('\n')[0]

async function withTimeout(fn, ms) {
  let timer
  const timeout = new Promise((_, fail) => {
    timer = setTimeout(() => fail(new Error(`timed out after ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([Promise.resolve().then(fn), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {string} name the suite name
 * @param {{ dir: string }} options dir: the suite's artifacts folder
 */
export function createSuite(name, { dir }) {
  const state = { name, dir, steps: [], failures: [], knownIssues: [], warnings: [], shots: [] }
  const apps = [] // open launch handles of this suite, the current one last
  const clients = []
  const brokers = []
  const profilesBefore = new Set(kitProfiles())
  let problems = [] // unexpected console / page errors not reported yet
  let allow = null // allow-list of the running step
  let absorb = null // console errors of the running known issue
  let buffer = null // log lines of the running step (printed after its status)
  let running = false

  const current = () => apps.at(-1) ?? null
  const page = () => {
    const app = current()
    if (!app) throw new Error('no app is open in this suite: call ctx.launch() first')
    return app.page
  }
  const print = (line) => (buffer ? buffer.push(line) : console.log(line))
  const flush = () => {
    for (const line of buffer ?? []) console.log(line)
    buffer = null
  }

  const onConsole = ({ kind, text }) => {
    if (kind === 'warning') state.warnings.push(text)
    else if (absorb) absorb.push(text)
    else if (!allow?.some((pattern) => matches(pattern, text))) problems.push(text)
  }

  /** Lets late console events of the step arrive (one round trip per app, then a short wait). */
  const settle = async () => {
    // Bounded: a page that is crashed or stuck in a navigation must not hang the step.
    for (const app of apps)
      if (app.page)
        await within(
          app.page.evaluate(() => 0),
          2_000
        )
    await sleep(150)
  }

  const checkWindows = async () => {
    for (const app of apps) if (!app.closed) await assertOffscreen(app.app)
  }

  const evidence = async (file) => {
    const app = current()
    if (!app?.page) return null
    try {
      await app.page.screenshot({ path: file, timeout: 5_000 })
      return file
    } catch {
      // The page is gone (crashed or closed): capture the window through main instead.
      return within(capturePage(app.app, file), 5_000, null)
    }
  }

  const fail = async (label, error) => {
    state.failures.push({ step: label, error: error?.stack ?? String(error) })
    console.error(`\n✗ ${state.name}: step "${label}" failed:\n  ${error?.stack ?? error}`)
    const file = await evidence(join(dir, `FAILED-${slug(label)}.png`))
    if (file) console.error(`  screenshot: ${file}`)
    for (const line of problems) console.error(`  console error: ${line}`)
  }

  const begin = (label) => {
    if (state.failures.length > 0) throw new SuiteAborted(`not run after a failure: ${label}`)
    if (running) throw new Error(`"${label}" started inside another step`)
    running = true
    buffer = []
    process.stdout.write(`  • ${label} … `)
    return Date.now()
  }

  /**
   * Runs one named step. A failure, a console / page error, a window on the desktop or a focused
   * window fails the step: FAILED-<step>.png is saved and the suite stops (SuiteAborted).
   *
   * @param {string} label
   * @param {() => Promise<unknown>} fn
   * @param {{ allowErrors?: (RegExp|string)[], timeout?: number }} [options] allowErrors:
   *   console / page errors EXPECTED during this step (matched by RegExp or substring).
   */
  async function step(label, fn, options = {}) {
    const started = begin(label)
    allow = options.allowErrors ?? null
    try {
      const result = await withTimeout(fn, options.timeout ?? STEP_TIMEOUT)
      if (allow) await settle()
      await checkWindows()
      if (problems.length > 0) throw new Error(`console error: ${problems[0]}`)
      const ms = Date.now() - started
      state.steps.push({ name: label, ms })
      console.log(`ok (${ms} ms)`)
      flush()
      return result
    } catch (error) {
      console.log('FAILED')
      flush()
      await fail(label, error)
      throw new SuiteAborted(label)
    } finally {
      allow = null
      running = false
    }
  }

  /**
   * A step that is known to fail: a failure (or a console error) is reported as KNOWN ISSUE and
   * the suite goes on; a pass is reported as 'known issue now passes: make it a normal step'.
   * Resolves true when it passed. Keep it self-contained: restore the UI state in a finally.
   */
  async function knownIssue(label, reason, fn, options = {}) {
    const started = begin(label)
    if (problems.length > 0) {
      // Errors from before the known issue are not part of it.
      running = false
      console.log('FAILED')
      flush()
      await fail(label, new Error(`console error before the known issue: ${problems[0]}`))
      throw new SuiteAborted(label)
    }
    absorb = []
    let error = null
    try {
      await withTimeout(fn, options.timeout ?? STEP_TIMEOUT)
    } catch (caught) {
      error = caught
    }
    await settle()
    if (!error && absorb.length > 0) error = new Error(`console error: ${absorb[0]}`)
    absorb = null
    running = false
    const passed = error === null
    const ms = Date.now() - started
    state.knownIssues.push({ name: label, reason, passed, error: error && firstLine(error) })
    if (passed) {
      console.log(`ok (${ms} ms) — known issue now passes: make it a normal step`)
    } else {
      console.log(`KNOWN ISSUE (${ms} ms): ${reason}`)
      print(`      ${firstLine(error)}`)
      await evidence(join(dir, `KNOWN-${slug(label)}.png`))
    }
    flush()
    try {
      await checkWindows()
    } catch (windowError) {
      await fail(label, windowError)
      throw new SuiteAborted(label)
    }
    return passed
  }

  /** Launches the app (launchApp options); it becomes the current app of the helpers. */
  async function launch(options = {}) {
    const handle = await launchApp({ tag: name, ...options, onConsole, log: print })
    apps.push(handle)
    const close = handle.close
    handle.close = async (closeOptions) => {
      const result = await close(closeOptions)
      const index = apps.indexOf(handle)
      if (index !== -1) apps.splice(index, 1)
      return result
    }
    return handle
  }

  const ctx = {
    name,
    /** This suite's screenshot folder. */
    artifacts: dir,
    /** The broker the runner started for a suite with `broker` set (else null). */
    broker: null,
    step,
    knownIssue,
    /** Prints an indented line (after the running step's status line). */
    log: (...parts) => print(`      ${parts.join(' ')}`),
    launch,
    startBroker: async (options) => {
      const broker = await startBroker(options)
      brokers.push(broker)
      return broker
    },
    rawClient: async (url, options) => {
      const target = url ?? ctx.broker?.url
      if (!target) throw new Error('rawClient: give a url (this suite has no ctx.broker)')
      const client = await rawClient(target, options)
      clients.push(client)
      return client
    },
    /** The current launch handle / its Playwright ElectronApplication / its first window. */
    get handle() {
      return current()
    },
    get app() {
      return current()?.app ?? null
    },
    get page() {
      return current()?.page ?? null
    },
    tid,
    sleep,
    slug,
    ...pageHelpers(page, { dir: () => dir, onShot: (file) => state.shots.push(file) })
  }

  /** After run(ctx): late console errors, then everything closed and every profile deleted. */
  async function finish() {
    if (state.failures.length === 0 && apps.length > 0) {
      await settle()
      if (problems.length > 0) await fail('after the last step', `console error: ${problems[0]}`)
    }
    const notes = []
    for (const client of clients.reverse()) await client.close().catch(() => undefined)
    for (const app of [...apps].reverse()) {
      const { killed, removed } = await app.close()
      if (killed) {
        notes.push(`app (pid ${app.pid}) did not quit in time: its process tree was killed`)
      }
      if (!removed) notes.push(`profile not deleted: ${app.userData}`)
    }
    for (const broker of brokers.reverse()) await broker.close().catch(() => undefined)
    for (const profile of kitProfiles()) {
      if (!profilesBefore.has(profile) && !removeProfile(profile)) {
        notes.push(`profile not deleted: ${profile}`)
      }
    }
    return notes
  }

  return { ctx, state, finish, fail }
}
