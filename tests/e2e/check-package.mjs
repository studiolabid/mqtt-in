/**
 * Packaging check (Windows; build-only, never an installer):
 *
 *   npm run test:package        (node tests/e2e/check-package.mjs [--keep])
 *
 * 1. Builds the app into out-package and packages it with `electron-builder --win --dir` into
 *    dist-package (electron-builder.yml as is, except for those two folders; never from out/).
 * 2. Inspects dist-package/win-unpacked: the fuse wire of mqtt-in.exe, what app.asar holds (an
 *    allowlist, trimmed node_modules, licenses kept, no source maps or other builds), its size
 *    (under 8 MB), the locales (en-US only) and the unpacked icon.
 * 3. Runs the packaged mqtt-in.exe in automation mode over CDP: the welcome screen on
 *    app://mqtt-in/index.html with no console errors, file:// unreachable, the studiolab.id credit
 *    and the version, an off-screen tool window titled 'mqtt-in (automation)', an MQTT round trip
 *    against an in-process aedes broker, and exit code 0 once the window closes.
 * 4. Deletes out-package and dist-package (--keep leaves them for a look).
 *
 * Screenshots go to MQTTIN_E2E_ARTIFACTS (default <os tmpdir>/mqtt-in-package).
 * Exit code 0 = every check passed, 1 = a check failed.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ROOT, buildApp, packageApp } from './lib/package-build.mjs'
import { inspectPackage } from './lib/package-inspect.mjs'
import { smokeRun } from './lib/package-smoke.mjs'

const OUT_NAME = 'out-package'
const DIST_NAME = 'dist-package'
const OUT = join(ROOT, OUT_NAME)
const DIST = join(ROOT, DIST_NAME)
const LOCK = join(DIST, 'check-package.pid')
const ARTIFACTS = resolve(process.env.MQTTIN_E2E_ARTIFACTS || join(tmpdir(), 'mqtt-in-package'))
const keep = process.argv.includes('--keep')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const isRunning = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** Takes over out-package and dist-package, unless another check-package run is using them. */
function claimFolders() {
  const owner = existsSync(LOCK) ? Number(readFileSync(LOCK, 'utf8')) : 0
  if (owner && owner !== process.pid && isRunning(owner)) {
    throw new Error(
      `another check-package run (PID ${owner}) is using ${OUT_NAME} and ${DIST_NAME}`
    )
  }
  for (const folder of [OUT, DIST]) rmSync(folder, { recursive: true, force: true, maxRetries: 5 })
  mkdirSync(DIST, { recursive: true })
  writeFileSync(LOCK, String(process.pid))
}

function removeFolders() {
  for (const folder of [OUT, DIST]) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  }
}

if (process.platform !== 'win32') {
  console.error(
    'check-package packages and runs the Windows build (mqtt-in.exe): run it on Windows.'
  )
  process.exit(1)
}

let claimed = false
try {
  claimFolders()
  claimed = true
  mkdirSync(ARTIFACTS, { recursive: true })
  console.log(`mqtt-in package check — v${version}, ${OUT_NAME} → ${DIST_NAME}`)

  const build = await buildApp(OUT_NAME)
  console.log(`• build: ${OUT_NAME} in ${build.seconds.toFixed(1)} s`)
  const packaging = await packageApp(OUT_NAME, DIST_NAME)
  const steps = packaging.output
    .split('\n')
    .filter((line) => /fuses|asar integrity|packaging/.test(line))
  console.log(`• package: ${DIST_NAME}/win-unpacked in ${packaging.seconds.toFixed(1)} s`)
  for (const line of steps) console.log(`  ${line.trim()}`)

  const appDir = join(DIST, 'win-unpacked')
  console.log('• static checks')
  await inspectPackage(appDir, { check, version })
  console.log('• packaged smoke run (automation mode, CDP)')
  await smokeRun(join(appDir, 'mqtt-in.exe'), { check, artifacts: ARTIFACTS, version })
  console.log(`  screenshots: ${ARTIFACTS}`)
} catch (error) {
  check('check-package ran to the end', false, String(error?.stack ?? error))
} finally {
  try {
    if (claimed && !keep) removeFolders()
    else if (claimed) rmSync(LOCK, { force: true })
  } catch (error) {
    check(`${OUT_NAME} and ${DIST_NAME} removed`, false, error.message)
  }
}

const failed = results.filter((result) => !result.ok)
const passed = `${results.length - failed.length}/${results.length}`
console.log(`\n${failed.length === 0 ? '✓' : '✗'} ${passed} package checks passed`)
if (keep) console.log(`  kept ${OUT_NAME} and ${DIST_NAME}`)
process.exitCode = failed.length === 0 ? 0 : 1
