/**
 * IN-04, geometry: the message detail shows the payload first (UX-03), subscription rows show
 * their counter and filter on a click at the centre (UX-06/16), a 21-character topic filter fits
 * (UX-10), toasts never cover actions at three window sizes (UX-04), the publisher header fits
 * narrow panels, zoom keeps message rows (A11Y-07), and empty states never overlap the tabs at the
 * minimum window size (UX-11). Toasts are raised deterministically: storage notices from main.
 */
import { setWindowSize, setZoom, sleep, tid } from '../kit.mjs'
import {
  createConnection,
  dismissToasts,
  publishAll,
  pushStorageNotice,
  showTab,
  subscribe,
  treeRow,
  waitForRow
} from '../lib/ui.mjs'
import {
  actionTargets,
  captureWindow,
  detailPayloadPlacement,
  expectPublisherHeaderFits,
  heightOf,
  intersects,
  shotNow,
  toastRects
} from '../lib/ui-geometry.mjs'

const JSON_DOC = JSON.stringify({ temp: 21.5, unit: 'C', list: [1, 2, 3], nested: { ok: true } })

export default {
  name: 'ui-layout',
  order: 45,
  broker: true,

  async run(ctx) {
    const { step, capture } = ctx
    const page = () => ctx.page

    /** Raises `count` toasts and checks them against every visible action target. */
    const checkToasts = async (where, count) => {
      for (let i = 0; i < count; i++) {
        await pushStorageNotice(ctx.app, `Toast ${i + 1} at ${where}: long enough to wrap onto a second line.`)
      }
      await page().waitForFunction(
        (n) => document.querySelectorAll('[data-sonner-toast]').length >= n,
        count
      )
      await sleep(700) // the toasts slide in
      const view = await page().evaluate(() => ({ w: innerWidth, h: innerHeight }))
      const toasts = await toastRects(page())
      const targets = await actionTargets(page())
      const hits = []
      for (const toast of toasts) {
        for (const target of targets) if (intersects(toast, target)) hits.push(target.name)
      }
      if (hits.length > 0) throw new Error(`${where}: toasts cover ${[...new Set(hits)].join(', ')}`)
      const bottom = Math.max(...toasts.map((t) => t.bottom))
      const left = Math.min(...toasts.map((t) => t.left))
      const width = Math.max(...toasts.map((t) => t.width))
      if (bottom > view.h - 28 || Math.abs(left - 12) > 1 || width > 340.5) {
        throw new Error(`${where}: toasts at left ${left}, bottom ${bottom} of ${view.h}, ${width} px wide`)
      }
      ctx.log(`${where} (${view.w}×${view.h}): ${toasts.length} toasts clear of ${targets.map((t) => t.name).join(', ')}`)
    }

    await step('launch, connect, subscribe and receive messages', async () => {
      await ctx.launch({ size: { width: 1280, height: 800 } })
      await createConnection(ctx, { name: 'Layout' })
      await subscribe(ctx, '#')
      await subscribe(ctx, 'e2e/#')
      const client = await ctx.rawClient()
      await publishAll(client, 'e2e/json', [JSON_DOC])
      await publishAll(client, 'e2e/text', ['online'])
      await publishAll(client, 'e2e/num', ['20', '21', '22'])
      await waitForRow(ctx, 'e2e/num', 'in')
    })

    await step('the message detail shows the payload without scrolling (UX-03)', async () => {
      await ctx.click('message-row', '[data-topic="e2e/json"][data-direction="in"]')
      await ctx.waitForTestId('message-detail-payload', { extra: ' .cm-line' })
      await sleep(300)
      const placement = await detailPayloadPlacement(page())
      ctx.log(`payload line ${placement.lineTop} px into a ${placement.scrollerHeight} px scroller`)
      if (placement.scrollTop !== 0 || !placement.inside) {
        throw new Error(`the payload is below the fold: ${JSON.stringify(placement)}`)
      }
      if (!/\d\d:\d\d:\d\d\.\d{3} · \d+ B · QoS \d · /.test(placement.summary)) {
        throw new Error(`summary line "${placement.summary}"`)
      }
      await capture('lay-01-message-detail')
      await page().locator(tid('message-detail')).getByRole('button', { name: /^Close/ }).click()
      await ctx.waitForTestId('message-detail', { state: 'hidden' })
    })

    await step('subscription rows show their counter; a centre click filters (UX-06/16)', async () => {
      const first = page().locator(tid('subscription-item')).first()
      const second = page().locator(tid('subscription-item')).nth(1)
      await first.locator(tid('subscription-count')).waitFor()
      const box = await first.boundingBox()
      await page().mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await ctx.waitForTestId('subscription-item', { extra: '[data-filtered="true"]' })
      if (await page().locator(tid('subscription-dialog')).isVisible()) {
        throw new Error('the click at the row centre opened the edit dialog')
      }
      // The filtered row must look different from a merely hovered one (UX-08).
      const secondBox = await second.boundingBox()
      await page().mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2)
      await sleep(250)
      const filtered = await first.evaluate((el) => getComputedStyle(el).backgroundColor)
      const hovered = await second.evaluate((el) => getComputedStyle(el).backgroundColor)
      if (filtered === hovered) throw new Error(`filtered and hovered rows share ${filtered}`)
      await shotNow(ctx, 'lay-02-subscription-filtered')
      await page().mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await ctx.waitForTestId('subscription-item', { extra: '[data-filtered="true"]', state: 'hidden' })
      await page().mouse.move(1, 1)
    })

    await step('a 21-character topic filter fits its field (UX-10)', async () => {
      const input = page().locator(tid('message-topic-filter'))
      await input.click()
      await input.fill('sensors/+/temperature')
      await sleep(400)
      const fit = await input.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
      ctx.log(`scrollWidth ${fit.scroll}, clientWidth ${fit.client}`)
      if (fit.scroll > fit.client) throw new Error(`the filter is cut: ${JSON.stringify(fit)}`)
      await shotNow(ctx, 'lay-03-topic-filter')
      await input.fill('')
      await page().keyboard.press('Escape')
    })

    for (const [width, height] of [
      [960, 600],
      [1280, 800],
      [1920, 1080]
    ]) {
      await step(`toasts never cover actions at ${width}×${height} (UX-04)`, async () => {
        await setWindowSize(ctx.app, width, height)
        await checkToasts('the workspace', 3)
        await shotNow(ctx, `lay-04-toasts-${width}x${height}`)
        await ctx.click('sidebar-new-connection')
        await ctx.waitForTestId('connection-form')
        await sleep(300)
        await checkToasts('the connection dialog', 1)
        await shotNow(ctx, `lay-05-toasts-dialog-${width}x${height}`)
        await ctx.click('connection-cancel')
        await ctx.waitForTestId('connection-form', { state: 'hidden' })
        await dismissToasts(page())
      })
    }

    await step('Alt+T moves the focus to the toasts and outlines them (A11Y-21)', async () => {
      await setWindowSize(ctx.app, 1280, 800)
      await pushStorageNotice(ctx.app, 'A toast for Alt+T.')
      await page().locator('[data-sonner-toast]').first().waitFor()
      await sleep(400)
      await page().keyboard.press('Alt+t')
      await sleep(300)
      const focus = await page().evaluate(() => ({
        toaster: document.activeElement?.hasAttribute('data-sonner-toaster') ?? false,
        outline: getComputedStyle(document.querySelector('[data-sonner-toast]')).outlineStyle
      }))
      if (!focus.toaster || focus.outline !== 'solid') {
        throw new Error(`after Alt+T: ${JSON.stringify(focus)}`)
      }
      await capture('lay-06-alt-t')
      await dismissToasts(page())
    })

    await step('the publisher header fits at 960×600 (no control over another)', async () => {
      await setWindowSize(ctx.app, 960, 600)
      const header = await expectPublisherHeaderFits(page(), '976×608')
      ctx.log(`header ${Math.round(header.width)} px: ${header.names.join(', ')}`)
      await capture('lay-07-workspace-960x600')
      await setWindowSize(ctx.app, 1280, 800)
    })

    let before = null
    await step('zoom 150 %: the message list keeps two rows (A11Y-07)', async () => {
      before = {
        publisher: await heightOf(page(), tid('publisher-panel')),
        layout: await page().evaluate(() => localStorage.getItem('mqtey.workspace.layout'))
      }
      await setZoom(ctx.app, 1.5)
      await sleep(300)
      const list = await heightOf(page(), tid('message-list'))
      ctx.log(`message list ${Math.round(list)} px, publisher ${Math.round(await heightOf(page(), tid('publisher-panel')))} px`)
      if (list < 104) throw new Error(`the message list is ${list} px at 150 %`)
      await expectPublisherHeaderFits(page(), 'zoom 150 %')
      await captureWindow(ctx, 'lay-08-zoom-150')
    })

    await step('zoom 200 %: the publisher folds or a row stays; its header fits', async () => {
      await setZoom(ctx.app, 2)
      await sleep(300)
      const list = await heightOf(page(), tid('message-list'))
      const publisher = await heightOf(page(), tid('publisher-panel'))
      ctx.log(`message list ${Math.round(list)} px, publisher ${Math.round(publisher)} px`)
      if (!(publisher <= 41.5 || list >= 52)) {
        throw new Error(`at 200 %: list ${list} px, publisher ${publisher} px`)
      }
      await expectPublisherHeaderFits(page(), 'zoom 200 %')
      await captureWindow(ctx, 'lay-09-zoom-200')
    })

    await step('zoom 100 %: the layout comes back; zooming remembered nothing', async () => {
      await setZoom(ctx.app, 1)
      await sleep(400)
      const publisher = await heightOf(page(), tid('publisher-panel'))
      if (Math.abs(publisher - before.publisher) > 2) {
        throw new Error(`the publisher is ${publisher} px, ${before.publisher} px before zooming`)
      }
      const layout = await page().evaluate(() => localStorage.getItem('mqtey.workspace.layout'))
      if (layout !== before.layout) throw new Error(`zoom changed the layout: ${before.layout} → ${layout}`)
    })

    await step('at the minimum size the chart empty state stays below the tabs (UX-11)', async () => {
      const size = await setWindowSize(ctx.app, 960, 600)
      await showTab(ctx, 'topics')
      await (await treeRow(ctx, 'e2e/text')).click()
      await ctx.click('topic-tab-chart')
      await page().locator(`${tid('topic-detail')} [data-slot="empty-state"]`).first().waitFor()
      await sleep(300)
      const geometry = await page().evaluate(() => {
        const detail = document.querySelector('[data-testid="topic-detail"]')
        const empty = [...detail.querySelectorAll('[data-slot="empty-state"]')].find(
          (el) => el.getBoundingClientRect().height > 0
        )
        const tabs = detail.querySelector('[role="tablist"]')
        return {
          contentTop: empty?.firstElementChild?.getBoundingClientRect().top,
          boxTop: empty?.parentElement?.getBoundingClientRect().top,
          tabsBottom: tabs?.getBoundingClientRect().bottom
        }
      })
      ctx.log(`${size.width}×${size.height}: ${JSON.stringify(geometry)}`)
      if (!(geometry.contentTop >= geometry.boxTop && geometry.contentTop >= geometry.tabsBottom)) {
        throw new Error(`the empty state overlaps the tabs: ${JSON.stringify(geometry)}`)
      }
      await capture('lay-10-empty-state-960x600')
    })
  }
}
