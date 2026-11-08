/**
 * The suite runner. It discovers tests/e2e/suites/*.mjs, sorts them by `order`, then name, and
 * runs each one with its own context (apps, profiles, brokers): fail-fast inside a suite, on to
 * the next suite after a failure. Then a summary, and a check that no Electron process of this
 * run is left. Resolves the exit code: 0 when every suite passed, 1 otherwise.
 *
 *   MQTTIN_E2E_ONLY=main,ui-layout   only these suites (`ui-*` matches a prefix)
 *   MQTTIN_E2E_ALL=1                 the optIn suites (perf, slow) too
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createdProfiles, kitProfiles, openApps, removeProfile, startedApps } from './app.mjs'
import { ARTIFACTS, MAIN, OUT_DIR, SUITES_DIR } from './paths.mjs'
import { findLeftovers, killLeftover, killTree } from './processes.mjs'
import { createSuite, SuiteAborted } from './session.mjs'

/** Screenshots of a suite that writes into the artifacts root (main: the README's names). */
const ROOT_SHOTS = /^(FAILED-.*|KNOWN-.*|\d\d-[a-z0-9-]+-(light|dark))\.png$/

const listSuites = () =>
  readdirSync(SUITES_DIR)
    .filter((file) => file.endsWith('.mjs') && !/^[._]/.test(file))
    .map((file) => ({ id: basename(file, '.mjs'), file: join(SUITES_DIR, file) }))

async function load({ id, file }) {
  try {
    const module = await import(pathToFileURL(file).href)
    const suite = module.default ?? module
    if (typeof suite.run !== 'function') throw new Error('it exports no run(ctx) function')
    if (suite.name !== undefined && suite.name !== id) {
      throw new Error(`its name "${suite.name}" is not its file name "${id}"`)
    }
    return {
      id,
      order: Number.isFinite(suite.order) ? suite.order : 100,
      optIn: suite.optIn === true,
      broker: suite.broker ?? false,
      root: suite.artifacts === 'root',
      run: suite.run
    }
  } catch (error) {
    return { id, order: Number.POSITIVE_INFINITY, loadError: error }
  }
}

/** The suites to run (MQTTIN_E2E_ONLY / MQTTIN_E2E_ALL), or an error message. */
async function select() {
  const all = listSuites()
  const only = (process.env.MQTTIN_E2E_ONLY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const everything = process.env.MQTTIN_E2E_ALL === '1'
  const named = new Set(only.filter((pattern) => !pattern.endsWith('*')))
  const prefixes = only.filter((pattern) => pattern.endsWith('*')).map((p) => p.slice(0, -1))
  const unknown = [...named].filter((id) => !all.some((suite) => suite.id === id))
  if (unknown.length > 0) {
    return `unknown suite(s) in MQTTIN_E2E_ONLY: ${unknown.join(', ')} (have: ${all.map((s) => s.id).join(', ')})`
  }
  const picked =
    only.length === 0
      ? all
      : all.filter((suite) => {
          return named.has(suite.id) || prefixes.some((prefix) => suite.id.startsWith(prefix))
        })
  const suites = (await Promise.all(picked.map(load)))
    .filter((suite) => !suite.optIn || everything || named.has(suite.id))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return suites.length > 0 ? suites : `no suite to run (MQTTIN_E2E_ONLY=${only.join(',')})`
}

/** Removes the screenshots of the suite's previous run (only its own: the folder is shared). */
function prepare(dir, root) {
  mkdirSync(dir, { recursive: true })
  for (const file of readdirSync(dir)) {
    if (root ? ROOT_SHOTS.test(file) : file.endsWith('.png')) {
      rmSync(join(dir, file), { force: true })
    }
  }
}

async function runOne(suite) {
  console.log(`\n▸ ${suite.id}`)
  if (suite.loadError) {
    console.error(
      `✗ ${suite.id}: cannot load the suite: ${suite.loadError?.stack ?? suite.loadError}`
    )
    return { id: suite.id, steps: 0, ms: 0, failures: 1, known: 0, shots: 0 }
  }
  const dir = suite.root ? ARTIFACTS : join(ARTIFACTS, suite.id)
  prepare(dir, suite.root)
  const { ctx, state, finish, fail } = createSuite(suite.id, { dir })
  const started = Date.now()
  try {
    if (suite.broker) ctx.broker = await ctx.startBroker(suite.broker === true ? {} : suite.broker)
    await suite.run(ctx)
  } catch (error) {
    if (!(error instanceof SuiteAborted)) await fail('outside a step', error)
  }
  const notes = await finish()
  const ms = Date.now() - started
  for (const note of notes) console.log(`  ! ${note}`)
  if (state.warnings.length > 0) {
    console.log(`  ${state.warnings.length} console warning(s):`)
    for (const line of state.warnings) console.log(`    ${line}`)
  }
  const known = state.knownIssues.filter((issue) => !issue.passed).length
  for (const issue of state.knownIssues.filter((entry) => entry.passed)) {
    console.log(`  ! known issue now passes, make it a normal step: ${issue.name}`)
  }
  return {
    id: suite.id,
    steps: state.steps.length,
    ms,
    failures: state.failures.length,
    known,
    shots: state.shots.length
  }
}

/** Electron processes of this run that are still alive: listed, killed (they are ours). */
function leakCheck() {
  try {
    const mains = startedApps.map(({ pid, script }) => ({ pid, script }))
    const leftovers = findLeftovers({ mains, profiles: createdProfiles })
    for (const leftover of leftovers) {
      console.error(`✗ left running: pid ${leftover.pid} ${leftover.command.slice(0, 160)}`)
      killLeftover(leftover)
    }
    return leftovers.length
  } catch (error) {
    console.log(`  (process check skipped: ${String(error?.message ?? error).split('\n')[0]})`)
    return 0
  }
}

function printSummary(rows, leftovers) {
  const pad = (value, width) => String(value).padStart(width)
  console.log(
    `\n  ${'suite'.padEnd(22)} ${pad('steps', 5)} ${pad('time', 8)} failures  known issues`
  )
  for (const row of rows) {
    const time = `${(row.ms / 1000).toFixed(1)} s`
    console.log(
      `  ${row.id.padEnd(22)} ${pad(row.steps, 5)} ${pad(time, 8)} ${pad(row.failures, 8)}  ${pad(row.known, 12)}`
    )
  }
  const failed = rows.filter((row) => row.failures > 0)
  const steps = rows.reduce((sum, row) => sum + row.steps, 0)
  const total = (rows.reduce((sum, row) => sum + row.ms, 0) / 1000).toFixed(1)
  const shots = rows.reduce((sum, row) => sum + row.shots, 0)
  if (failed.length === 0 && leftovers === 0) {
    console.log(`\n✓ mqtt-in e2e passed: ${rows.length} suite(s), ${steps} steps in ${total} s`)
  } else {
    const what = failed.map((row) => row.id).join(', ') || 'no suite'
    console.log(
      `\n✗ mqtt-in e2e failed: ${what}${leftovers ? `; ${leftovers} process(es) left running` : ''}`
    )
  }
  console.log(`  ${shots} screenshots in ${ARTIFACTS}`)
  return failed.length === 0 && leftovers === 0 ? 0 : 1
}

/** Ctrl+C: kill the apps of this run (their own process trees) and delete their profiles. */
function onInterrupt() {
  console.error('\nInterrupted: stopping the apps of this run')
  for (const handle of openApps) killTree(handle.app?.process())
  for (const dir of kitProfiles()) removeProfile(dir)
  process.exit(130)
}

export async function runSuites() {
  if (!existsSync(MAIN)) {
    console.error(`✗ ${MAIN} is missing: run "npx electron-vite build --outDir ${OUT_DIR}" first`)
    return 1
  }
  const suites = await select()
  if (typeof suites === 'string') {
    console.error(`✗ ${suites}`)
    return 1
  }
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onInterrupt)
  console.log(
    `mqtt-in e2e — ${OUT_DIR}, ${suites.length} suite(s): ${suites.map((s) => s.id).join(', ')}`
  )
  const rows = []
  for (const suite of suites) rows.push(await runOne(suite))
  return printSummary(rows, leakCheck())
}
