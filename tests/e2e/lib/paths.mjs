/**
 * Paths and options of an e2e run (read once from the environment).
 *
 *   MQTEY_E2E_OUT        the build to run: out (default) or out-<name> (`--outDir out-<name>`)
 *   MQTEY_E2E_ARTIFACTS  screenshot folder (default: <os tmpdir>/mqtey-e2e)
 */
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository root. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
export const E2E_DIR = join(ROOT, 'tests', 'e2e')
export const SUITES_DIR = join(E2E_DIR, 'suites')

/** The build folder, relative to ROOT. */
export const OUT_DIR = process.env.MQTEY_E2E_OUT || 'out'
if (basename(resolve(ROOT, OUT_DIR)).toLowerCase() === 'out-run') {
  // The user's own mqtey runs from out-run: an automated run never touches it.
  throw new Error('MQTEY_E2E_OUT=out-run is the user’s own build: build into out-<name> instead')
}
/** The built main script that every launch starts. */
export const MAIN = join(ROOT, OUT_DIR, 'main', 'index.js')

export const ARTIFACTS = resolve(process.env.MQTEY_E2E_ARTIFACTS || join(tmpdir(), 'mqtey-e2e'))

/** Default timeout of locator waits and Playwright actions (ms). */
export const TIMEOUT = 15_000
/** Default timeout of one step (ms): a step that hangs fails instead of blocking the run. */
export const STEP_TIMEOUT = 120_000
