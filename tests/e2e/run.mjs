/**
 * mqtt-in end-to-end run: every suite in tests/e2e/suites/ against the built app (out/, or
 * MQTTIN_E2E_OUT=out-<name>) and in-process aedes brokers.
 *
 *   npm run test:e2e                     (electron-vite build && node tests/e2e/run.mjs)
 *   node tests/e2e/run.mjs               again, without rebuilding
 *   MQTTIN_E2E_ONLY=main node tests/e2e/run.mjs     one suite (comma list; `ui-*` for a prefix)
 *   MQTTIN_E2E_ALL=1 node tests/e2e/run.mjs         the optIn suites (perf, slow) too
 *
 * Screenshots go to MQTTIN_E2E_ARTIFACTS (default: <os tmpdir>/mqtt-in-e2e). Exit code 0 = every
 * suite passed, 1 = a suite failed (its failing step is captured as FAILED-<step>.png).
 * The runner is in lib/runner.mjs, the helpers in kit.mjs; see README.md.
 */
import { runSuites } from './lib/runner.mjs'

const code = await runSuites()
process.exitCode = code
// Let the output drain; then make sure nothing (a stray socket or timer) keeps the run alive.
setTimeout(() => process.exit(code), 3_000).unref()
