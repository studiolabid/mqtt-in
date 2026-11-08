/**
 * IN-07, data features: copy a message as a mosquitto_pub / mqttx command (FP-4, clipboard
 * stubbed), the detail's format resets per message (FD-03), pinned values with one multi-series
 * chart that survive a restart on the same profile, and the 8-pin limit (FP-3), 'Clear retained
 * below…' on a branch (FP-1: a late subscriber receives nothing, the publish history is unchanged)
 * and an authentication failure that leads with 'Edit connection' (FD-15).
 */
import { clipboardText, nativeCalls, sleep, tid } from '../kit.mjs'
import {
  createConnection,
  openConnection,
  publishAll,
  showTab,
  subscribe,
  treeRow,
  waitForRow,
  waitForToast
} from '../lib/ui.mjs'
import { focusRing } from '../lib/ui-modes.mjs'

const RETAINED = ['e2e/ret/a/b/1', 'e2e/ret/a/b/2', 'e2e/ret/a/b/3']
const HEADER_PIN = `${tid('topic-detail')} ${tid('topic-pin')}[data-pin-source="header"]`

export default {
  name: 'ui-topics',
  order: 65,
  broker: true,

  async run(ctx) {
    const { step, capture } = ctx
    const page = () => ctx.page
    let raw = null
    let id = null
    const tiles = () => page().locator(tid('pinned-tile'))
    const pin = async (topic) => {
      await (await treeRow(ctx, topic)).click()
      await page().locator(HEADER_PIN).click()
      await page().locator(`${HEADER_PIN}[aria-pressed="true"]`).waitFor()
    }

    await step('seed retained topics, launch, connect and receive', async () => {
      raw = await ctx.rawClient()
      for (const topic of [...RETAINED, 'e2e/ret/keep']) {
        await raw.publishAsync(topic, `cfg ${topic}`, { retain: true, qos: 1 })
      }
      await ctx.launch({ size: { width: 1280, height: 800 } })
      id = await createConnection(ctx, { name: 'Topics' })
      await subscribe(ctx, '#')
      await waitForRow(ctx, 'e2e/ret/keep', 'in')
      for (let i = 0; i < 5; i++) {
        await publishAll(raw, 'e2e/num/a', [String(20 + i)])
        await publishAll(raw, 'e2e/num/b', [JSON.stringify({ temp: 10 + i, hum: 40 + i })])
        await sleep(40)
      }
      await publishAll(raw, 'e2e/codec/msgpack', [Buffer.from([0x81, 0xa1, 0x61, 0x01])])
      await publishAll(raw, 'e2e/codec/json', ['{"a":1,"list":[1,2]}'])
      await waitForRow(ctx, 'e2e/codec/json', 'in')
    })

    await step('a message copies as a mosquitto_pub / mqttx command (FP-4)', async () => {
      const port = ctx.broker.port
      await page()
        .locator(tid('message-row', '[data-topic="e2e/num/a"]'))
        .first()
        .click({ button: 'right' })
      await page().locator(tid('copy-as-command')).first().hover()
      await ctx.waitForTestId('copy-as-mosquitto')
      await ctx.shot('topics-01-copy-as-command')
      await page().locator(tid('copy-as-mosquitto')).first().click()
      await waitForToast(page(), 'Command copied')
      const pub = await clipboardText(page())
      if (
        !new RegExp(
          `^mosquitto_pub -h 127\\.0\\.0\\.1 -p ${port} -V mqttv311 -t e2e/num/a -m \\d+$`
        ).test(pub ?? '')
      ) {
        throw new Error(`copied "${pub}"`)
      }
      await page().locator(tid('message-row', '[data-topic="e2e/num/b"]')).first().click()
      await page()
        .locator(tid('message-detail'))
        .getByRole('button', { name: 'More actions' })
        .click()
      await page().locator(tid('copy-as-command')).last().hover()
      await page().locator(tid('copy-as-mqttx')).last().click()
      await page().waitForFunction(() => /^mqttx /.test(window.__clip ?? ''))
      const mqttx = await clipboardText(page())
      if (
        !new RegExp(
          `^mqttx pub -h 127\\.0\\.0\\.1 -p ${port} -V 3\\.1\\.1 -t e2e/num/b -m '\\{"temp":\\d+,"hum":\\d+\\}'$`
        ).test(mqttx ?? '')
      ) {
        throw new Error(`copied "${mqttx}"`)
      }
      const system = await nativeCalls(ctx.app, 'clipboard.writeText')
      if (system.length > 0) throw new Error('the system clipboard was written')
    })

    await step('the detail format resets for the next message (FD-03)', async () => {
      const format = () => page().locator(`${tid('message-detail')} [aria-label="View payload as"]`)
      await page().locator(tid('message-row', '[data-topic="e2e/codec/msgpack"]')).first().click()
      await format().click()
      await page().getByRole('option', { name: 'MessagePack' }).click()
      await page().waitForFunction(() =>
        /"a"/.test(
          document.querySelector('[data-testid="message-detail-payload"]')?.textContent ?? ''
        )
      )
      await page().locator(tid('message-row', '[data-topic="e2e/codec/json"]')).first().click()
      await page().waitForFunction(() =>
        /"list"/.test(
          document.querySelector('[data-testid="message-detail-payload"]')?.textContent ?? ''
        )
      )
      const shown = ((await format().textContent()) ?? '').trim()
      const failed = await page()
        .locator(tid('message-detail-payload'), { hasText: 'Invalid MessagePack' })
        .count()
      if (shown !== 'Auto' || failed > 0)
        throw new Error(`the next message shows "${shown}" (errors: ${failed})`)
      await page()
        .locator(tid('message-detail'))
        .getByRole('button', { name: /^Close/ })
        .click()
    })

    await step('two pins: two tiles and one chart with two series (FP-3)', async () => {
      await showTab(ctx, 'topics')
      await pin('e2e/num/a')
      await pin('e2e/num/b')
      await page().waitForFunction(
        () => document.querySelectorAll('[data-testid="pinned-tile"]').length === 2
      )
      await ctx.click('pinned-chart-toggle')
      await page()
        .locator(`${tid('pinned-chart')} canvas`)
        .first()
        .waitFor({ timeout: 10_000 })
      const chart = await page().evaluate(() => {
        const root = document.querySelector('[data-testid="pinned-chart"]')
        return {
          charts: root.querySelectorAll('[data-slot="time-series-chart"]').length,
          series: [...root.querySelectorAll('button[title^="Hide "]')].map((b) => b.title.slice(5))
        }
      })
      ctx.log(JSON.stringify(chart))
      if (chart.charts !== 1 || chart.series.length !== 2)
        throw new Error(`pinned chart ${JSON.stringify(chart)}`)
      await capture('topics-02-pinned-chart')
    })

    await ctx.knownIssue(
      'the chart legend buttons have a full-strength focus ring (TimeSeriesChart)',
      'components/common/TimeSeriesChart.vue legend buttons use focus-visible:ring-ring/50 (hand-off to final)',
      async () => {
        const ring = await focusRing(
          page(),
          page()
            .locator(`${tid('pinned-chart')} button[title^="Hide "]`)
            .first()
        )
        if (!ring.fullStrength) throw new Error(`focus ring ${JSON.stringify(ring)}`)
      }
    )

    await step('the pins survive a restart on the same profile (FP-3)', async () => {
      await ctx.click('pinned-chart-toggle')
      // Saved 500 ms after the last change (and on unload): wait until main has them.
      await page().waitForFunction(
        async (connection) =>
          ((await window.mqtey.storage.get('mqtey.pins'))?.[connection] ?? []).length === 2,
        id,
        { timeout: 5_000, polling: 100 }
      )
      const profile = ctx.handle.userData
      await ctx.handle.close({ keepProfile: true })
      await ctx.launch({ userData: profile, size: { width: 1280, height: 800 } })
      if (!(await page().locator(tid('workspace')).isVisible())) await openConnection(ctx, id)
      await ctx.click('workspace-connect')
      await ctx.waitForTestId('workspace-connect', { extra: '[data-status="connected"]' })
      await showTab(ctx, 'topics')
      await ctx.waitForTestId('pinned-strip', { timeout: 10_000 })
      const pinned = await tiles().evaluateAll((els) => els.map((el) => el.dataset.topic).sort())
      if (pinned.join() !== 'e2e/num/a,e2e/num/b')
        throw new Error(`after the restart: ${pinned.join()}`)
    })

    await step(
      "eight pins at most: the 9th says 'Unpin one first (8 pins max)' (FP-3)",
      async () => {
        for (let i = 0; i < 7; i++) await publishAll(raw, `e2e/many/${i}`, [String(i)])
        for (let i = 0; i < 6; i++) await pin(`e2e/many/${i}`)
        await (await treeRow(ctx, 'e2e/many/6')).click()
        await page().locator(HEADER_PIN).click()
        await waitForToast(page(), 'Unpin one first (8 pins max)')
        if ((await tiles().count()) !== 8) throw new Error(`${await tiles().count()} tiles`)
        await capture('topics-03-eight-pins')
      }
    )

    await step(
      "'Clear retained below…' empties a branch; the history is unchanged (FP-1)",
      async () => {
        const branch = await treeRow(ctx, 'e2e/ret/a')
        await branch.click({ button: 'right' })
        const item = await ctx.waitForTestId('topic-clear-retained-below')
        if (!/\(3\)/.test((await item.textContent()) ?? ''))
          throw new Error(`menu item "${await item.textContent()}"`)
        await item.click()
        const confirm = await ctx.waitForTestId('confirm-dialog')
        if (!/Clear 3 retained messages\?/.test((await confirm.textContent()) ?? ''))
          throw new Error('confirm text')
        await ctx.shot('topics-04-clear-retained-confirm')
        await ctx.click('confirm-accept')
        await waitForToast(page(), '3 retained messages cleared')
        const late = await ctx.rawClient()
        const got = []
        late.on('message', (topic) => got.push(topic))
        await late.subscribeAsync('e2e/ret/#', { qos: 1 })
        await sleep(800)
        if (got.join() !== 'e2e/ret/keep')
          throw new Error(`a late subscriber received ${got.join(', ')}`)
        await ctx.click('publish-history')
        const history = await ctx.waitForTestId('publish-history-panel')
        if (/e2e\/ret/.test((await history.textContent()) ?? ''))
          throw new Error('the clears entered the history')
        await ctx.pressEscapeUntilHidden('publish-history-panel')
      }
    )

    await step(
      "an authentication failure leads with 'Edit connection', then 'Retry' (FD-15)",
      async () => {
        const refuse = await ctx.startBroker({
          authenticate: (_client, username, _password, done) =>
            username === 'bad'
              ? done(Object.assign(new Error('bad user'), { returnCode: 4 }), false)
              : done(null, true)
        })
        await createConnection(ctx, {
          name: 'Bad login',
          port: refuse.port,
          username: 'bad',
          status: 'error'
        })
        const empty = await ctx.waitForTestId('message-empty-state', {
          extra: '[data-kind="disconnected"]'
        })
        await page().waitForFunction(() =>
          /Edit connection/.test(
            document.querySelector('[data-testid="message-empty-state"]')?.textContent ?? ''
          )
        )
        const buttons = (await empty.locator('button').allTextContents()).map((text) => text.trim())
        if (buttons.join('|') !== 'Edit connection|Retry')
          throw new Error(`actions: ${buttons.join(' | ')}`)
        await capture('topics-05-auth-failure')
      }
    )
  }
}
