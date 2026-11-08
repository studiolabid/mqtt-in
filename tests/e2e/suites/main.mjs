/**
 * The main flow against an in-process aedes broker (MQTT 3.1.1): welcome → connection (3.1.1) →
 * subscribe → publish → message detail → topic chart → logs → settings → command palette.
 * Its screenshots keep their names in the artifacts root (the README uses them).
 */
import { TIMEOUT } from '../kit.mjs'

export default {
  name: 'main',
  order: 10,
  artifacts: 'root',

  async run(ctx) {
    const { tid, sleep, step, click, fill, waitForTestId, shot, capture, captureModal } = ctx
    let broker = null

    await step('start the broker', async () => {
      broker = await ctx.startBroker()
    })

    await step('launch the app', async () => {
      await ctx.launch()
      await waitForTestId('welcome', { timeout: 30_000 })
      await ctx.page.mouse.move(1, 1)
      await capture('01-welcome')
    })

    await step('title bar leaves room for the window controls', async () => {
      const bar = await ctx.page.evaluate(() => {
        const overlay = navigator.windowControlsOverlay
        const reserve = document.querySelector('[data-testid="window-controls-reserve"]')
        return {
          visible: overlay?.visible ?? false,
          free: overlay?.getTitlebarAreaRect().width ?? innerWidth,
          reserve: reserve?.getBoundingClientRect().width ?? 0,
          width: innerWidth
        }
      })
      // Windows / Linux draw the controls over the page (macOS reserves the traffic lights in CSS).
      if (bar.visible && Math.abs(bar.width - bar.free - bar.reserve) > 1) {
        throw new Error(
          `title bar reserve ${bar.reserve}px, controls need ${bar.width - bar.free}px`
        )
      }
    })

    await step('open the connection dialog', async () => {
      await captureModal('02-connection-dialog', 'sidebar-new-connection', 'connection-form')
      await ctx.openModal('sidebar-new-connection', 'connection-form')
    })

    await step('fill the connection form (MQTT 3.1.1)', async () => {
      await fill('connection-name', 'E2E broker')
      await fill('connection-host', '127.0.0.1')
      await fill('connection-port', String(broker.port))
      await click('connection-version-4')
      await waitForTestId('connection-version-4', { extra: '[aria-pressed="true"]' })
      await shot('03-connection-filled')
    })

    await step('test the connection before saving', async () => {
      await click('connection-test')
      await waitForTestId('connection-test-result', { extra: '[data-ok="true"]' })
      await shot('03b-connection-tested')
      // Any edit clears the result (it describes the settings it was made with).
      await fill('connection-name', 'E2E broker ')
      await waitForTestId('connection-test-result', { state: 'hidden' })
      await fill('connection-name', 'E2E broker')
    })

    await step('save and connect', async () => {
      await click('connection-save-connect')
      await waitForTestId('connection-form', { state: 'hidden' })
      await waitForTestId('workspace-connect', { extra: '[data-status="connected"]' })
      await capture('04-workspace-connected')
    })

    await step('subscribe to #', async () => {
      await click('subscription-add')
      await waitForTestId('subscription-dialog')
      await fill('subscription-topic', '#')
      await shot('05-subscription-dialog')
      await click('subscription-save')
      await waitForTestId('subscription-dialog', { state: 'hidden' })
      await waitForTestId('subscription-item', { extra: '[data-state="subscribed"]' })
    })

    await step('publish e2e/hello', async () => {
      await fill('publish-topic', 'e2e/hello')
      await ctx.page.keyboard.press('Escape') // closes the topic suggestions
      await ctx.page.locator(tid('publish-payload', ' .cm-content')).click()
      await ctx.page.keyboard.press('ControlOrMeta+A')
      await ctx.page.keyboard.insertText('{"temp": 21.5}')
      await click('publish-button')
      for (const direction of ['out', 'in']) {
        await waitForTestId('message-row', {
          extra: `[data-topic="e2e/hello"][data-direction="${direction}"]`
        })
      }
      await capture('06-messages')
    })

    await step('popovers and menus open inside the window', async () => {
      await click('publish-history')
      await ctx.expectInViewport('publish-history-panel')
      await ctx.pressEscapeUntilHidden('publish-history-panel')
      await click('messages-export')
      await ctx.expectInViewport('messages-export-menu')
      await ctx.pressEscapeUntilHidden('messages-export-menu')
    })

    await step('open the message detail', async () => {
      await click('message-row', '[data-topic="e2e/hello"][data-direction="in"]')
      await waitForTestId('message-detail')
      await capture('07-message-detail')
    })

    await step('publish 5 sensor values from a raw client', async () => {
      const client = await ctx.rawClient(broker.url, { protocolVersion: 4 })
      for (let i = 0; i < 5; i++) {
        const payload = JSON.stringify({ temperature: 20 + i * 0.5, humidity: 40 + ((i * 7) % 5) })
        await client.publishAsync('e2e/sensor', payload, { qos: 1 })
        await sleep(120)
      }
      await client.close()
      await waitForTestId('message-row', { extra: '[data-topic="e2e/sensor"]' })
    })

    await step('topic explorer and chart', async () => {
      await click('workspace-tab-topics')
      await click('topic-row', '[data-topic="e2e/sensor"]')
      await waitForTestId('topic-detail')
      await click('topic-tab-chart')
      await waitForTestId('topic-chart')
      await ctx.page.waitForSelector(`${tid('topic-chart')} canvas`, { timeout: TIMEOUT })
      await capture('08-topics-chart')
    })

    await step('logs', async () => {
      await click('workspace-tab-logs')
      await waitForTestId('log-row')
      await capture('09-logs')
    })

    await step('settings: dark then light theme', async () => {
      await click('open-settings')
      await waitForTestId('settings')
      await click('settings-theme-dark')
      await ctx.expectTheme(true)
      await shot('10-settings')
      await click('settings-theme-light')
      await ctx.expectTheme(false)
      await shot('10-settings')
    })

    await step('command palette', async () => {
      await captureModal('11-command-palette', 'command-palette-trigger', 'command-palette')
    })
  }
}
