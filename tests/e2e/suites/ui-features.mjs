/**
 * IN-07, app-level features: the first run (one call to action, the 'Powered by studiolab.id'
 * credit on the welcome screen, in the status bar and in Settings > About; UX-15), broker info
 * and the live RTT (FP-5), the palette's workspace commands and Ctrl+Shift+P (UX-09), unread
 * counts of a background connection (FP-2), exports without secrets by default (SEC-10) and one
 * busy state for every import / export entry point (RC-22). Native dialogs stay stubbed.
 */
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { nextDialogResult, sleep, tid } from '../kit.mjs'
import {
  connectionItem,
  createConnection,
  holdDialog,
  openConnection,
  openPalette,
  paletteOption,
  publishAll,
  runPalette,
  subscribe,
  waitForFocus,
  waitForToast
} from '../lib/ui.mjs'
import { focusRing } from '../lib/ui-modes.mjs'

const PASSWORD = 'hunter2-SECRET'
const WORKSPACE_COMMANDS = [
  ['pause', 'Pause messages'],
  ['edit connection', 'Edit connection…'],
  ['export messages as json', 'Export messages as JSON…'],
  ['export messages as csv', 'Export messages as CSV…'],
  ['duplicate', 'Duplicate connection'],
  ['delete connection', 'Delete connection…'],
  ['copy broker', 'Copy broker URL'],
  ['focus publish', 'Focus publish topic'],
  ['focus message', 'Focus message list'],
  ['disconnect all', 'Disconnect all']
]

export default {
  name: 'ui-features',
  order: 60,
  broker: true,

  async run(ctx) {
    const { step, capture } = ctx
    const page = () => ctx.page
    const ids = {}

    await step('first run: one call to action and the studiolab.id credit (UX-15)', async () => {
      await ctx.launch({ size: { width: 1280, height: 800 } })
      await ctx.waitForTestId('welcome')
      const screen = await page().evaluate(() => ({
        ctas: [...document.querySelectorAll('button')].filter(
          (b) => b.checkVisibility() && /New connection/.test(b.textContent ?? '')
        ).length,
        sidebarPresets: document.querySelector('#sidebar-quick-start') !== null,
        presets: [...document.querySelectorAll('[data-testid^="preset-"]')].filter((el) =>
          el.checkVisibility()
        ).length,
        presetsOutside: [...document.querySelectorAll('[data-testid^="preset-"]')].filter(
          (el) => !el.closest('[data-testid="welcome"]')
        ).length
      }))
      ctx.log(JSON.stringify(screen))
      if (
        screen.ctas !== 1 ||
        screen.sidebarPresets ||
        screen.presets === 0 ||
        screen.presetsOutside > 0
      ) {
        throw new Error(`first-run screen: ${JSON.stringify(screen)}`)
      }
      const credit = await page().locator(tid('welcome')).locator(tid('powered-by')).textContent()
      if (!/Powered by\s*studiolab\.id/.test(credit ?? ''))
        throw new Error(`welcome credit "${credit}"`)
      const bar = page().locator(tid('statusbar-powered-by'))
      if (
        !(await bar.isVisible()) ||
        (await bar.getAttribute('aria-label')) !== 'Powered by studiolab.id'
      ) {
        throw new Error('no "Powered by studiolab.id" in the status bar')
      }
      await capture('feat-01-welcome')
    })

    await ctx.knownIssue(
      'the welcome credit link has a full-strength focus ring (PoweredBy)',
      'components/common/PoweredBy.vue still uses focus-visible:ring-3 ring-ring/50 (hand-off to final)',
      async () => {
        const ring = await focusRing(page(), page().locator(`${tid('powered-by')} a`))
        if (!ring.fullStrength) throw new Error(`focus ring ${JSON.stringify(ring)}`)
      }
    )

    await step('Settings > About says Powered by studiolab.id', async () => {
      await ctx.click('open-settings')
      await ctx.waitForTestId('settings')
      const about = page().locator(`${tid('settings')} ${tid('powered-by')}`)
      await about.scrollIntoViewIfNeeded()
      if (!/Powered by\s*studiolab\.id/.test((await about.textContent()) ?? '')) {
        throw new Error('no credit in Settings > About')
      }
      await ctx.click('settings-back')
      await ctx.waitForTestId('welcome')
    })

    await step(
      'the live RTT shows after a ping; the broker popover explains 3.1.1 (FP-5)',
      async () => {
        ids.alpha = await createConnection(ctx, { name: 'Alpha', keepalive: 2 })
        await subscribe(ctx, '#')
        // Keep alive 2 s: mqtt.js pings after 2 s without traffic; the PINGRESP gives the RTT.
        const rtt = await ctx.waitForTestId('status-rtt', { timeout: 10_000 })
        const text = ((await rtt.textContent()) ?? '').replace(/\s+/g, ' ').trim()
        if (!/^RTT\s*(Round trip\s*)?[\d,.]+ ms$/.test(text))
          throw new Error(`RTT readout "${text}"`)
        ctx.log(`status bar: ${text}`)
        await ctx.click('broker-info-trigger')
        const info = await ctx.waitForTestId('broker-info')
        const body = (await info.textContent()) ?? ''
        if (
          !/MQTT 3\.1\.1 brokers do not announce their limits/.test(body) ||
          !/Session present/.test(body)
        ) {
          throw new Error(`broker popover: ${body.slice(0, 160)}`)
        }
        await sleep(300)
        await ctx.shot('feat-02-broker-info')
        await ctx.pressEscapeUntilHidden('broker-info')
      }
    )

    await step('the palette lists the workspace commands (UX-09)', async () => {
      for (const [term, label] of WORKSPACE_COMMANDS) {
        await openPalette(ctx, term)
        if ((await paletteOption(page(), label).count()) === 0)
          throw new Error(`"${term}" finds no "${label}"`)
        await ctx.pressEscapeUntilHidden('command-palette')
      }
      await publishAll(await ctx.rawClient(), 'e2e/palette', ['1'])
      await ctx.waitForTestId('message-row', { extra: '[data-topic="e2e/palette"]' })
    })

    await ctx.knownIssue(
      "the palette's 'Focus publish topic' / 'Focus message list' move the focus (FA-03)",
      'focusFirst skips the targets while the closing palette keeps the app aria-hidden, so focus ' +
        'returns to the pre-palette element (hand-off to final)',
      async () => {
        await page().locator(tid('message-list')).focus()
        await runPalette(ctx, 'focus publish')
        await waitForFocus(page(), 'publish-topic')
        await runPalette(ctx, 'focus message')
        await waitForFocus(page(), 'message-list')
      }
    )

    await step('Pause from the palette; Ctrl+Shift+P toggles it (UX-09)', async () => {
      await runPalette(ctx, 'pause messages')
      await ctx.waitForTestId('messages-pause', { extra: '[aria-pressed="true"]' })
      await page().keyboard.press('Control+Shift+P')
      await ctx.waitForTestId('messages-pause', { extra: '[aria-pressed="false"]' })
      await page().keyboard.press('Control+Shift+P')
      await ctx.waitForTestId('messages-pause', { extra: '[aria-pressed="true"]' })
      await ctx.shot('feat-03-paused')
      await page().keyboard.press('Control+Shift+P')
      await ctx.waitForTestId('messages-pause', { extra: '[aria-pressed="false"]' })
    })

    await step('a background connection counts its unread messages (FP-2)', async () => {
      ids.beta = await createConnection(ctx, { name: 'Beta' })
      await subscribe(ctx, '#')
      await openConnection(ctx, ids.alpha)
      await publishAll(await ctx.rawClient(), 'e2e/unread', ['1', '2', '3', '4', '5'])
      const pill = connectionItem(page(), ids.beta).locator(tid('connection-unread'))
      await page().waitForFunction(
        (id) =>
          document
            .querySelector(
              `[data-testid="connection-item"][data-connection-id="${id}"] [data-testid="connection-unread"]`
            )
            ?.textContent?.trim() === '5',
        ids.beta,
        { timeout: 5_000 }
      )
      if (
        (await connectionItem(page(), ids.alpha).locator(tid('connection-unread')).count()) !== 0
      ) {
        throw new Error('the open connection shows an unread pill')
      }
      await capture('feat-04-unread')
      await openConnection(ctx, ids.beta)
      await pill.waitFor({ state: 'detached', timeout: 3_000 })
    })

    await step('exports leave passwords out unless asked; the choice resets (SEC-10)', async () => {
      await createConnection(ctx, {
        name: 'Secret',
        username: 'alice',
        password: PASSWORD,
        connect: false
      })
      await ctx.click('open-settings')
      await ctx.waitForTestId('settings')
      const box = page().locator(tid('export-include-secrets'))
      await box.scrollIntoViewIfNeeded()
      const state = () => box.getAttribute('data-state')
      if ((await state()) !== 'unchecked') throw new Error('secrets are included by default')
      const exportTo = async (name) => {
        const file = join(ctx.handle.userData, name)
        await nextDialogResult(ctx.app, 'showSaveDialog', { canceled: false, filePath: file })
        await ctx.click('settings-export-connections')
        for (let i = 0; i < 50 && !existsSync(file); i++) await sleep(100)
        if (!existsSync(file)) throw new Error(`${name} was not written`)
        return readFileSync(file, 'utf8')
      }
      const plain = await exportTo('export-default.json')
      if (plain.includes(PASSWORD) || !plain.includes('alice'))
        throw new Error('the default export has the password')
      await waitForToast(page(), 'passwords not included')
      await box.click()
      if ((await state()) !== 'checked') throw new Error('the box did not tick')
      await capture('feat-05-settings-data')
      const secret = await exportTo('export-secrets.json')
      if (!secret.includes(PASSWORD)) throw new Error('the opt-in export has no password')
      await waitForToast(page(), 'includes passwords in plain text')
      await page().waitForFunction(
        () =>
          document
            .querySelector('[data-testid="export-include-secrets"]')
            ?.getAttribute('data-state') === 'unchecked'
      )
    })

    await step('import and export show one busy state everywhere (RC-22)', async () => {
      const exportHold = await holdDialog(ctx.app, 'showSaveDialog')
      try {
        await ctx.click('settings-export-connections')
        await ctx.waitForTestId('settings-export-connections', { extra: '[aria-busy="true"]' })
        await page().locator(tid('sidebar')).getByRole('button', { name: 'More actions' }).click()
        const item = await ctx.waitForTestId('sidebar-export-all')
        if ((await item.getAttribute('data-disabled')) === null)
          throw new Error('"Export all…" stays enabled')
        await ctx.shot('feat-06-export-busy')
        await page().keyboard.press('Escape')
      } finally {
        await exportHold.release({ canceled: true, filePath: '' })
      }
      await ctx.waitForTestId('settings-export-connections', { extra: ':not([aria-busy])' })
      const importHold = await holdDialog(ctx.app, 'showOpenDialog')
      try {
        await ctx.click('sidebar-import')
        await ctx.waitForTestId('settings-import-connections', {
          extra: '[aria-busy="true"][disabled]'
        })
        await ctx.waitForTestId('sidebar-import', { extra: '[disabled]' })
      } finally {
        await importHold.release({ canceled: true, filePaths: [] })
      }
      await ctx.waitForTestId('settings-import-connections', { extra: ':not([disabled])' })
      await ctx.click('settings-back')
    })
  }
}
