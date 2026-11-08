/**
 * IN-04, keyboard and screen readers: the palette gives the focus back (A11Y-08), focus never
 * falls to <body> after Ctrl+1/2/3, Settings Back or Clear messages (A11Y-11, FD-17), the log
 * list is a listbox with aria-activedescendant and one Tab stop (A11Y-09/12), Shift+F10 opens the
 * selected topic's menu (A11Y-14), virtual rows carry their set position (FD-13), the toolbar
 * names its controls (FD-09/16), Delete then Enter keeps a connection (A11Y-19) and the live
 * region says 'reconnecting' when the broker goes away (A11Y-17).
 */
import { sleep, tid } from '../kit.mjs'
import {
  activeElement,
  connectionItem,
  createConnection,
  openPalette,
  publishAll,
  showTab,
  subscribe,
  treeRow,
  waitForFocus,
  waitForRow
} from '../lib/ui.mjs'

export default {
  name: 'ui-a11y',
  order: 50,
  broker: true,

  async run(ctx) {
    const { step, capture } = ctx
    const page = () => ctx.page
    let client = null
    let second = null

    await step('launch, connect two connections and receive messages', async () => {
      await ctx.launch({ size: { width: 1280, height: 800 } })
      second = await createConnection(ctx, { name: 'Second', connect: false })
      await createConnection(ctx, { name: 'Keyboard' })
      await subscribe(ctx, '#')
      client = await ctx.rawClient()
      await publishAll(client, 'e2e/a11y/json', ['{"t":1}', '{"t":2}'])
      await publishAll(client, 'e2e/a11y/text', ['hello'])
      await waitForRow(ctx, 'e2e/a11y/text', 'in')
    })

    await step('the palette gives the focus back to where it was (A11Y-08)', async () => {
      await page().locator(tid('publish-topic')).focus()
      await openPalette(ctx, 'Show topics')
      await page().keyboard.press('Enter')
      await waitForFocus(page(), 'publish-topic')
      await showTab(ctx, 'messages')
      await page().locator(tid('publish-topic')).focus()
      await openPalette(ctx, 'New subscription')
      await page().keyboard.press('Enter')
      await ctx.waitForTestId('subscription-dialog')
      await page().keyboard.press('Escape')
      await ctx.waitForTestId('subscription-dialog', { state: 'hidden' })
      await waitForFocus(page(), 'publish-topic')
    })

    await step('Ctrl+1/2/3 move the focus into the shown view (A11Y-11)', async () => {
      await page().locator(tid('message-list')).focus()
      await page().keyboard.press('Control+2')
      await waitForFocus(page(), 'topic-tree')
      await page().keyboard.press('Control+3')
      await waitForFocus(page(), 'log-list')
      await page().keyboard.press('Control+1')
      const focused = await waitForFocus(page(), (value) => value !== 'BODY' && value !== 'log-list')
      const inMessages = await page().evaluate(() =>
        Boolean(document.activeElement?.closest('[data-testid="message-panel"], [role="tabpanel"]'))
      )
      if (!inMessages) throw new Error(`Ctrl+1 left the focus on ${focused}`)
      ctx.log(`Ctrl+1 → ${focused}`)
    })

    await step('Settings and Back keep the focus off <body> (A11Y-11)', async () => {
      await page().keyboard.press('Control+,')
      await ctx.waitForTestId('settings')
      await waitForFocus(page(), (value) => value !== 'BODY')
      await page().locator(tid('settings-back')).focus()
      await page().keyboard.press('Enter')
      await ctx.waitForTestId('workspace')
      const heading = await waitForFocus(page(), (value) => value.startsWith('h1:'))
      ctx.log(`after Back: ${heading}`)
    })

    await step('the log list is a listbox: the cursor is announced, one Tab leaves it (A11Y-09/12)', async () => {
      await showTab(ctx, 'logs')
      const list = page().locator(tid('log-list'))
      if ((await list.getAttribute('role')) !== 'listbox') throw new Error('the log list is no listbox')
      await list.focus()
      await page().keyboard.press('ArrowDown')
      await page().keyboard.press('ArrowDown')
      await sleep(150)
      const descendant = await list.getAttribute('aria-activedescendant')
      const row = page().locator(tid('log-row', '[data-active]'))
      const [id, role, selected] = await Promise.all([
        row.getAttribute('id'),
        row.getAttribute('role'),
        row.getAttribute('aria-selected')
      ])
      if (!descendant || descendant !== id || role !== 'option' || selected !== 'true') {
        throw new Error(`activedescendant ${descendant}, cursor row #${id} role ${role} selected ${selected}`)
      }
      await capture('a11y-01-log-cursor')
      await list.focus()
      await page().keyboard.press('Tab')
      const after = await waitForFocus(page(), (value) => value !== 'log-list')
      if (/Copy log entry/.test(after) || after === 'BODY') throw new Error(`one Tab went to ${after}`)
      ctx.log(`one Tab → ${after}`)
    })

    await step("Shift+F10 on the tree opens the selected topic's menu (A11Y-14)", async () => {
      await showTab(ctx, 'topics')
      await (await treeRow(ctx, 'e2e/a11y/json')).click()
      await page().locator(tid('topic-tree')).focus()
      await page().keyboard.press('Shift+F10')
      await page().getByRole('menuitem', { name: /Copy topic/ }).waitFor()
      await ctx.shot('a11y-02-tree-keyboard-menu')
      await page().keyboard.press('Escape')
      await page().getByRole('menuitem', { name: /Copy topic/ }).waitFor({ state: 'hidden' })
      await ctx.fill('topic-search', '')
    })

    await step('virtual rows carry their position in the whole set (FD-13)', async () => {
      const tree = await page().evaluate(() =>
        [...document.querySelectorAll('[data-testid="topic-row"]')].map((row) => [
          row.getAttribute('aria-posinset'),
          row.getAttribute('aria-setsize')
        ])
      )
      if (tree.length === 0 || !tree.every(([pos, size]) => Number(pos) >= 1 && Number(size) >= Number(pos))) {
        throw new Error(`topic rows: ${JSON.stringify(tree)}`)
      }
      await showTab(ctx, 'messages')
      const rows = await page().evaluate(() => {
        const all = [...document.querySelectorAll('[data-testid="message-row"]')]
        return { count: all.length, size: all[0]?.getAttribute('aria-setsize'), last: all.at(-1)?.getAttribute('aria-posinset') }
      })
      if (Number(rows.size) !== rows.count || Number(rows.last) !== rows.count) {
        throw new Error(`message rows: ${JSON.stringify(rows)}`)
      }
    })

    await step('the message toolbar names its controls; the count shows only when filtered (FD-09/16)', async () => {
      const info = await page().evaluate(() => ({
        role: document.querySelector('[aria-label="Message filters and actions"]')?.getAttribute('role'),
        retained: document.querySelector('[data-testid="retained-filter"]')?.getAttribute('aria-label'),
        count: document.querySelector('[data-testid="messages-match-count"]') !== null
      }))
      if (info.role !== 'group' || info.retained !== 'Retained messages only' || info.count) {
        throw new Error(`toolbar: ${JSON.stringify(info)}`)
      }
      const pause = page().locator(tid('messages-pause'))
      await pause.click()
      await publishAll(client, 'e2e/a11y/json', ['{"t":3}'])
      await page().waitForFunction(() => {
        const button = document.querySelector('[data-testid="messages-pause"]')
        const text = document.getElementById(button?.getAttribute('aria-describedby') ?? '')?.textContent
        return button?.getAttribute('aria-pressed') === 'true' && /new/.test(text ?? '')
      })
      const label = await pause.getAttribute('aria-label')
      if (label !== 'Pause live view') throw new Error(`the pressed pause button is named "${label}"`)
      await pause.click()
      await ctx.waitForTestId('messages-pause', { extra: '[aria-pressed="false"]' })
      await ctx.fill('message-search', 'e2e/a11y/json')
      // Shown in wide toolbars only (a container query), but always in the accessibility tree.
      const count = await ctx.waitForTestId('messages-match-count', { state: 'attached' })
      await page().waitForFunction(
        () => /^3 of 4 messages/.test(document.querySelector('[data-testid="messages-match-count"]')?.getAttribute('title') ?? '')
      )
      const counter = await count.textContent()
      if (!/3\s*\/\s*4/.test(counter ?? '')) throw new Error(`match count "${counter}"`)
      await ctx.fill('message-search', '')
      await ctx.waitForTestId('messages-match-count', { state: 'detached' })
      await page().mouse.move(1, 1)
    })

    await step('after Clear messages the focus is on the empty state action (FD-17)', async () => {
      await page().locator(tid('message-list')).focus()
      await page().keyboard.press('Control+L')
      await ctx.waitForTestId('confirm-dialog')
      await ctx.click('confirm-accept')
      await ctx.waitForTestId('confirm-dialog', { state: 'hidden' })
      const ok = await page()
        .waitForFunction(() => document.activeElement?.hasAttribute('data-primary-action'), null, {
          timeout: 3_000
        })
        .then(() => true)
        .catch(() => false)
      if (!ok) throw new Error(`after the clear the focus is on ${await activeElement(page())}`)
    })

    await step('Delete then Enter on a connection keeps it (A11Y-19)', async () => {
      await connectionItem(page(), second).locator('button[data-nav]').focus()
      await page().keyboard.press('Delete')
      await ctx.waitForTestId('confirm-dialog')
      await waitForFocus(page(), 'confirm-cancel')
      await ctx.shot('a11y-03-delete-confirm')
      await page().keyboard.press('Enter')
      await ctx.waitForTestId('confirm-dialog', { state: 'hidden' })
      await sleep(300)
      if ((await connectionItem(page(), second).count()) !== 1) throw new Error('the connection was deleted')
    })

    await step("the live region says 'reconnecting' when the broker goes away (A11Y-17)", async () => {
      await ctx.broker.close()
      await page().waitForFunction(
        () => /reconnecting/i.test(document.querySelector('[data-testid="status-announcer"]')?.textContent ?? ''),
        null,
        { timeout: 15_000 }
      )
      const text = await page().locator(tid('status-announcer')).textContent()
      ctx.log(`announced: ${text?.trim()}`)
      await capture('a11y-04-broker-lost')
    })
  }
}
