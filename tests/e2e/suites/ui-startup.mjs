/**
 * "Connect on startup": a marked connection is connected again when mqtt-in restarts (its
 * subscription receives the retained value without a click), and a renderer reload never
 * reconnects a connection the user closed (once per app run).
 */
import { createConnection, openConnection, subscribe, waitForRow } from '../lib/ui.mjs'

const TOPIC = 'e2e/startup/status'

export default {
  name: 'ui-startup',
  order: 66,
  broker: true,

  async run(ctx) {
    const { step, capture } = ctx
    let id = null

    await step('a connection marked "Connect on startup" connects and subscribes', async () => {
      const raw = await ctx.rawClient()
      await raw.publishAsync(TOPIC, '{"state":"on"}', { retain: true, qos: 1 })
      await ctx.launch({ size: { width: 1280, height: 800 } })
      id = await createConnection(ctx, { name: 'Startup', autoConnect: true })
      await subscribe(ctx, '#')
      await waitForRow(ctx, TOPIC, 'in')
    })

    await step('after a restart it is connected again without a click', async () => {
      const profile = ctx.handle.userData
      await ctx.handle.close({ keepProfile: true })
      await ctx.launch({ userData: profile, size: { width: 1280, height: 800 } })
      if (!(await ctx.page.locator('[data-testid="workspace"]').isVisible()))
        await openConnection(ctx, id)
      await ctx.waitForTestId('workspace-connect', {
        extra: '[data-status="connected"]',
        timeout: 10_000
      })
      await waitForRow(ctx, TOPIC, 'in')
      await capture('startup-01-auto-connected')
    })

    await step('a reload does not reconnect a connection the user closed', async () => {
      await ctx.click('workspace-connect')
      await ctx.waitForTestId('workspace-connect', { extra: '[data-status="disconnected"]' })
      await ctx.page.reload()
      await ctx.waitForTestId('workspace')
      // Give a (wrong) auto-connect time to start.
      await ctx.page.waitForTimeout(1500)
      const status = await ctx.page
        .locator('[data-testid="workspace-connect"]')
        .getAttribute('data-status')
      if (status !== 'disconnected') throw new Error(`after the reload: ${status}`)
    })
  }
}
