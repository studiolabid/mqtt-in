/**
 * Strict timings of the platform behaviour (optIn: they depend on the machine's load, so the
 * default run checks the same behaviour with generous bounds only):
 * - IN-02: a second launch on the same profile quits within about 2 s;
 * - IN-05 (2): a crashed renderer is back on its route, connected, within 5 s. Only once
 *   automation windows cannot be activated (see lib/platform-crash.mjs), else a known issue.
 *
 *   MQTTIN_E2E_ONLY=platform-timing node tests/e2e/run.mjs
 */
import { spawnApp } from '../kit.mjs'
import { connectionProfile, expect, openWorkspace, seedConnections } from '../lib/platform.mjs'
import { activationGate, restartRenderer } from '../lib/platform-crash.mjs'

const SECOND_LAUNCH_MS = 2_000
const CRASH_RECOVERY_MS = 5_000

export default {
  name: 'platform-timing',
  order: 90,
  optIn: true,
  broker: true,

  async run(ctx) {
    const { step, log } = ctx

    await step('launch and connect', async () => {
      await ctx.launch({
        seed: seedConnections([connectionProfile({ id: 'timing', port: ctx.broker.port })])
      })
      await openWorkspace(ctx.page, 'timing')
      await ctx.click('workspace-connect')
      await ctx.waitForTestId('workspace-connect', { extra: '[data-status="connected"]' })
    })

    await step(`a second launch quits within ${SECOND_LAUNCH_MS} ms`, async () => {
      const times = []
      for (let run = 0; run < 3; run++) {
        const second = await spawnApp({ userData: ctx.handle.userData, timeout: 15_000 })
        expect(second.code === 0 && !second.timedOut, 'the second launch did not quit', second.code)
        times.push(second.ms)
      }
      log(`exit after ${times.join(', ')} ms`)
      expect(Math.max(...times) <= SECOND_LAUNCH_MS, 'too slow', times)
    })

    const gate = await activationGate(ctx.app)
    if (!gate.safe) {
      await ctx.knownIssue(
        `a crashed renderer is back within ${CRASH_RECOVERY_MS} ms`,
        'not run: a crash would take the focus (hand-off to final: window-options.ts focusable: false)',
        async () => {
          throw new Error(`blocked: ${gate.reason}`)
        }
      )
      return
    }

    await step(`a crashed renderer is back within ${CRASH_RECOVERY_MS} ms`, async () => {
      const result = await restartRenderer(ctx, 'timing', { how: 'crash', timeout: 15_000 })
      log(`back after ${result.ms} ms`)
      expect(result.ms <= CRASH_RECOVERY_MS, 'too slow', result.ms)
      expect(!result.focused && !result.foreground, 'the window took the focus')
    })
  }
}
