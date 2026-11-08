/**
 * IN-03 (UX-01, FA-01): the publisher collapses and expands again. The tab-bar toggle, a double
 * click and Enter on the resize handle each toggle it; 'Edit & publish' (message detail and row
 * menu) reveals a collapsed publisher with the message's topic filled in; the collapsed state is
 * remembered across a reload. Before FA-01 nothing but a drag brought the publisher back.
 */
import { sleep, tid } from '../kit.mjs'
import { createConnection, publishAll, subscribe, waitForRow } from '../lib/ui.mjs'
import { heightOf } from '../lib/ui-geometry.mjs'

/** A collapsed publisher shows its 40 px header only; an expanded one is at least 150 px. */
const COLLAPSED_MAX = 41.5
const EXPANDED_MIN = 150
const TOPIC = 'e2e/edit/one'
const HANDLE = '[data-slot="resizable-handle"][aria-label^="Resize the publisher"]'

export default {
  name: 'ui-publisher',
  order: 40,
  broker: true,

  async run(ctx) {
    const { step, capture } = ctx
    const height = () => heightOf(ctx.page, tid('publisher-panel'))
    const toggle = () => ctx.page.locator(tid('toggle-publisher'))
    const layout = () =>
      ctx.page.evaluate(() =>
        JSON.parse(localStorage.getItem('mqtt-in.workspace.layout') ?? 'null')
      )

    /** Waits for the panel's height to settle on the expected side, then checks the toggle. */
    const expectState = async (collapsed, how) => {
      const ok = (h) => (collapsed ? h > 0 && h <= COLLAPSED_MAX : h > EXPANDED_MIN)
      let h = await height()
      for (let i = 0; i < 40 && !ok(h); i++) {
        await sleep(50)
        h = await height()
      }
      if (!ok(h))
        throw new Error(`${how}: publisher is ${h} px, expected ${collapsed ? '≤ 41' : '> 150'}`)
      const label = await toggle().getAttribute('aria-label')
      const expanded = await toggle().getAttribute('aria-expanded')
      const want = collapsed ? 'Show publisher' : 'Collapse publisher'
      if (label !== want || expanded !== String(!collapsed)) {
        throw new Error(
          `${how}: toggle says "${label}" (aria-expanded ${expanded}), want "${want}"`
        )
      }
      ctx.log(`${how}: ${Math.round(h)} px, toggle "${label}"`)
    }

    await step('launch, connect and receive two messages', async () => {
      await ctx.launch({ size: { width: 1280, height: 800 } })
      await createConnection(ctx, { name: 'Publisher' })
      await subscribe(ctx, '#')
      const client = await ctx.rawClient()
      await publishAll(client, TOPIC, ['{"a":1}', '{"a":2}'])
      await waitForRow(ctx, TOPIC, 'in')
      await expectState(false, 'at start')
      await capture('pub-01-expanded')
    })

    await step('the toggle collapses it (Show publisher, ~40 px, remembered)', async () => {
      await ctx.click('toggle-publisher')
      await expectState(true, 'after the toggle')
      await ctx.page.waitForFunction(
        () => JSON.parse(localStorage.getItem('mqtt-in.workspace.layout') ?? '{}').publishCollapsed,
        null,
        { timeout: 3_000 }
      )
      await capture('pub-02-collapsed')
    })

    await step('the collapsed publisher stays collapsed after a reload', async () => {
      await ctx.page.reload()
      await ctx.waitForTestId('workspace-connect', { extra: '[data-status="connected"]' })
      await expectState(true, 'after the reload')
      // The message buffer lives in the renderer: the reload emptied it.
      await publishAll(await ctx.rawClient(), TOPIC, ['{"a":3}', '{"a":4}'])
      await waitForRow(ctx, TOPIC, 'in')
    })

    await step('the toggle expands it again (remembered)', async () => {
      await ctx.click('toggle-publisher')
      await expectState(false, 'after the second toggle')
      // The layout is written 300 ms after the last change.
      const remembered = await ctx.page
        .waitForFunction(
          () =>
            JSON.parse(localStorage.getItem('mqtt-in.workspace.layout') ?? '{}')
              .publishCollapsed === false,
          null,
          { timeout: 3_000 }
        )
        .then(() => true)
        .catch(() => false)
      if (!remembered)
        throw new Error(`expanding is not remembered: ${JSON.stringify(await layout())}`)
    })

    await step('a double-click on the resize handle collapses and expands it', async () => {
      const handle = ctx.page.locator(HANDLE)
      await handle.dblclick()
      await expectState(true, 'after a double-click')
      await handle.dblclick()
      await expectState(false, 'after another double-click')
      await ctx.page.mouse.move(1, 1)
    })

    await step('Enter on the focused resize handle collapses and expands it', async () => {
      const handle = ctx.page.locator(HANDLE)
      await handle.focus()
      await ctx.page.keyboard.press('Enter')
      await expectState(true, 'after Enter')
      await ctx.page.keyboard.press('Enter')
      await expectState(false, 'after Enter again')
    })

    await step("'Edit & publish' in the message detail reveals it, topic filled in", async () => {
      await ctx.click('toggle-publisher')
      await expectState(true, 'collapsed again')
      await ctx.click('message-row', `[data-topic="${TOPIC}"][data-direction="in"]`)
      await ctx.waitForTestId('message-detail')
      await ctx.page
        .locator(tid('message-detail'))
        .getByRole('button', { name: 'Edit & publish' })
        .click()
      await expectState(false, "after 'Edit & publish'")
      const topic = await ctx.page.inputValue(tid('publish-topic'))
      if (topic !== TOPIC) throw new Error(`the publish topic is "${topic}", want "${TOPIC}"`)
      const payload = await ctx.page.locator(tid('publish-payload', ' .cm-content')).textContent()
      if (!/"a"/.test(payload ?? '')) throw new Error(`the payload editor shows "${payload}"`)
      await capture('pub-03-edit-and-publish')
    })

    await step("'Edit & publish' in the row menu reveals it too", async () => {
      await ctx.click('toggle-publisher')
      await expectState(true, 'collapsed once more')
      await ctx.fill('publish-topic', 'e2e/other')
      await ctx.page.keyboard.press('Escape')
      const row = ctx.page.locator(
        tid('message-row', `[data-topic="${TOPIC}"][data-direction="in"]`)
      )
      await row.first().click({ button: 'right' })
      await ctx.page.getByRole('menuitem', { name: 'Edit & publish' }).click()
      await expectState(false, "after the menu's 'Edit & publish'")
      const topic = await ctx.page.inputValue(tid('publish-topic'))
      if (topic !== TOPIC) throw new Error(`the publish topic is "${topic}", want "${TOPIC}"`)
      await ctx.page.mouse.move(1, 1)
    })
  }
}
