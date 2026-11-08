/**
 * IN-05 (2), SEC-12: the main process survives its own errors (uncaught exceptions and unhandled
 * rejections are logged in main.log, no error box), and a crashed renderer comes back on the
 * route it showed with the MQTT session still connected.
 *
 * The crash itself only runs once automation windows cannot be activated (see
 * lib/platform-crash.mjs): today a crash takes the user's foreground window, so until the
 * hand-off for src/main/window-options.ts lands it is reported as a known issue WITHOUT crashing.
 */
import { nativeCalls } from '../kit.mjs'
import {
  connectionProfile,
  expect,
  mainLog,
  openWorkspace,
  seedConnections,
  waitFor
} from '../lib/platform.mjs'
import { activationGate, crashLogLine, restartRenderer } from '../lib/platform-crash.mjs'

const ID = 'crash'

export default {
  name: 'platform-crash',
  order: 25,
  broker: true,

  async run(ctx) {
    const { step, log } = ctx

    await step('connect a workspace', async () => {
      await ctx.launch({
        seed: seedConnections([connectionProfile({ id: ID, name: 'Crash test', port: ctx.broker.port })])
      })
      await openWorkspace(ctx.page, ID)
      await ctx.click('workspace-connect')
      await ctx.waitForTestId('workspace-connect', { extra: '[data-status="connected"]' })
      expect(ctx.broker.clients().length === 1, 'the broker has no client')
    })

    await step('errors in the main process are logged, without an error box', async () => {
      await ctx.app.evaluate(() => {
        setTimeout(() => {
          throw new Error('e2e: uncaught in main')
        }, 0)
        void Promise.reject(new Error('e2e: unhandled rejection in main'))
      })
      const text = await waitFor(
        () => {
          const current = mainLog(ctx.handle)
          const rejection = current.includes(
            '[unhandledRejection] Error: e2e: unhandled rejection in main'
          )
          const uncaught = /\[uncaughtException\] Error: e2e: uncaught in main\n\s+at /.test(current)
          return rejection && uncaught ? current : null
        },
        { timeout: 5_000, label: 'both errors in main.log' }
      )
      expect(text.length > 0, 'main.log is empty')
      expect((await ctx.app.evaluate(({ app }) => app.getName())) === 'mqtey', 'main stopped')
      const dialogs = (await nativeCalls(ctx.app)).filter((call) => call.name.startsWith('dialog.'))
      expect(dialogs.length === 0, 'a dialog was requested', dialogs)
      await ctx.waitForTestId('workspace-connect', { extra: '[data-status="connected"]' })
    })

    await step('a reloaded renderer comes back on its route, still connected', async () => {
      const result = await restartRenderer(ctx, ID, { how: 'reload' })
      log(`back after ${result.ms} ms: ${result.workspace}`)
      expect(!result.focused && !result.foreground, 'the window took the focus')
      const session = result.sessions?.find((entry) => entry.connectionId === ID)
      expect(session?.status === 'connected', 'the session is not connected', result.sessions)
      expect(ctx.broker.clients().length === 1, 'the session reconnected instead of staying')
      await ctx.waitForTestId('workspace-connect', { extra: '[data-status="connected"]' })
    })

    const gate = await activationGate(ctx.app)
    log(`activation gate: ${gate.safe ? 'open' : `closed (${gate.reason})`}`)
    if (!gate.safe) {
      await ctx.knownIssue(
        'a crashed renderer comes back on its route, still connected',
        'not run: a crash would take the focus; automation windows can be activated (hand-off to final: window-options.ts focusable: false)',
        async () => {
          throw new Error(`blocked: ${gate.reason}`)
        }
      )
      return
    }

    await step('a crashed renderer comes back on its route, still connected', async () => {
      const result = await restartRenderer(ctx, ID, { how: 'crash' })
      log(`back after ${result.ms} ms: ${result.workspace}`)
      expect(!result.focused, 'the window took the focus')
      expect(!result.foreground, 'the window became the foreground window')
      const session = result.sessions?.find((entry) => entry.connectionId === ID)
      expect(session?.status === 'connected', 'the session is not connected', result.sessions)
      expect(ctx.broker.clients().length === 1, 'the session reconnected instead of staying')
      const line = crashLogLine(ctx.handle)
      expect(line !== null, "no '[render-process-gone]' in main.log")
      log(line.slice(0, 120))
    })
  }
}
