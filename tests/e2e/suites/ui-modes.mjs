/**
 * IN-04, display modes and visual states: status dots have one shape per state (RC-18; a real
 * 'error' from an MQTT 5 connection against aedes, MQ-07), one in-memory counter and one rate
 * readout (UX-14), the highlighted menu item's bar (RC-16), one border and one focus ring for
 * every text field (RC-07 + the field hand-off), Windows High Contrast (A11Y-02), reduced motion
 * (A11Y-16) and accent-coloured text in the contrast-safe shade (A11Y-06).
 */
import { sleep, tid } from '../kit.mjs'
import {
  connectionItem,
  createConnection,
  keyboardFocus,
  openConnection,
  publishAll,
  subscribe
} from '../lib/ui.mjs'
import {
  accentTextScan,
  enterAnimationDurations,
  fieldStyles,
  runningEnterAnimations
} from '../lib/ui-modes.mjs'

export default {
  name: 'ui-modes',
  order: 55,
  broker: true,

  async run(ctx) {
    const { step, capture } = ctx
    const page = () => ctx.page
    const ids = {}

    await step('launch with an idle, a failing (MQTT 5) and a connected connection', async () => {
      await ctx.launch({ size: { width: 1280, height: 800 } })
      ids.idle = await createConnection(ctx, { name: 'Idle', connect: false })
      ids.broken = await createConnection(ctx, { name: 'Broken v5', version: 5, status: 'error' })
      // MQ-07: one clear error, never a reconnect loop against a 3.1.1-only broker.
      const hint = await page().locator(tid('workspace')).textContent()
      if (!/does not support MQTT 5\.0/.test(hint ?? ''))
        throw new Error('no MQTT 5 hint in the workspace')
      await sleep(2_000)
      await ctx.waitForTestId('workspace-connect', {
        extra: '[data-status="error"]',
        timeout: 1_000
      })
      await ctx.click('workspace-tab-logs')
      await ctx.waitForTestId('log-row', { extra: '[data-level="error"]' })
      const errors = await page().locator(tid('log-row', '[data-level="error"]')).count()
      if (errors !== 1) throw new Error(`${errors} error rows in the log`)
      await ctx.click('workspace-tab-messages')
      ids.live = await createConnection(ctx, { name: 'Modes' })
      await subscribe(ctx, '#')
      await subscribe(ctx, 'off/#')
      await page().locator(tid('subscription-toggle')).nth(1).click()
      await ctx.waitForTestId('subscription-item', { extra: '[data-enabled="false"]' })
      await publishAll(await ctx.rawClient(), 'e2e/modes', ['{"v":1}', '{"v":2}'])
      await ctx.waitForTestId('message-row', { extra: '[data-topic="e2e/modes"]' })
      await page().mouse.move(1, 1)
    })

    await step('status dots have one shape per state (RC-18)', async () => {
      const glyph = (id) =>
        connectionItem(page(), id)
          .locator('[data-slot="status-dot"]')
          .first()
          .getAttribute('data-glyph')
      const shapes = {
        live: await glyph(ids.live),
        idle: await glyph(ids.idle),
        broken: await glyph(ids.broken)
      }
      ctx.log(JSON.stringify(shapes))
      if (shapes.live !== 'filled' || shapes.idle !== 'ring' || shapes.broken !== 'alert') {
        throw new Error(`glyphs ${JSON.stringify(shapes)}`)
      }
      await capture('modes-01-status-glyphs')
    })

    await step(
      'one in-memory counter and one rate readout in the window chrome (UX-14)',
      async () => {
        const chrome = await page().evaluate(() => {
          const text = (sel) => document.querySelector(sel)?.textContent ?? ''
          const header = text('[data-testid="workspace"] header')
          const inMemory = (sel) =>
            [...document.querySelectorAll(`${sel} [aria-label], ${sel} [title]`)].filter((el) =>
              /in memory/.test(`${el.getAttribute('aria-label')} ${el.getAttribute('title')}`)
            ).length
          return {
            headerCounters: /msgs|\d\s*\/s\b/.test(header),
            sidebarConnected: /\d+ connected/.test(text('[data-testid="sidebar"]')),
            statusCounters: inMemory('[data-testid="statusbar"]'),
            otherCounters:
              inMemory('[data-testid="sidebar"]') + inMemory('[data-testid="workspace"] header'),
            inRates: document.querySelectorAll('[title^="Incoming messages per second"]').length,
            outRates: document.querySelectorAll('[title^="Outgoing messages per second"]').length
          }
        })
        ctx.log(JSON.stringify(chrome))
        const ok =
          !chrome.headerCounters &&
          !chrome.sidebarConnected &&
          chrome.statusCounters === 1 &&
          chrome.otherCounters === 0 &&
          chrome.inRates === 1 &&
          chrome.outRates === 1
        if (!ok) throw new Error(`counters: ${JSON.stringify(chrome)}`)
      }
    )

    for (const dark of [false, true]) {
      await step(
        `the highlighted menu item has its bar (${dark ? 'dark' : 'light'}, RC-16)`,
        async () => {
          await ctx.setTheme(dark)
          await ctx.click('messages-export')
          await ctx.waitForTestId('messages-export-menu')
          await page().keyboard.press('ArrowDown')
          await sleep(200)
          const bar = await page().evaluate(() => {
            const item = document.querySelector(
              '[data-slot="dropdown-menu-item"][data-highlighted]'
            )
            return item ? getComputedStyle(item, '::before').backgroundColor : null
          })
          if (!bar || bar === 'rgba(0, 0, 0, 0)' || bar === 'transparent')
            throw new Error(`bar: ${bar}`)
          await ctx.shot('modes-02-menu-highlight')
          await ctx.pressEscapeUntilHidden('messages-export-menu')
        }
      )
    }

    await step('every text field has the same border and focus ring (RC-07)', async () => {
      await ctx.setTheme(false)
      await ctx.click('sidebar-new-connection')
      await ctx.waitForTestId('connection-form')
      const input = await fieldStyles(page(), page().locator(tid('connection-name')))
      const broker = await fieldStyles(
        page(),
        page().locator(tid('connection-host')),
        '[data-slot="input-group"]'
      )
      await ctx.click('connection-section-advanced')
      const number = await fieldStyles(
        page(),
        page().getByLabel('Keep alive', { exact: true }),
        '[data-slot="input-group"]'
      )
      ctx.log(`input ${JSON.stringify(input)}`)
      for (const [name, field] of [
        ['broker address', broker],
        ['keep alive', number]
      ]) {
        if (field.border !== input.border || field.focused !== input.focused) {
          throw new Error(
            `${name} field ${JSON.stringify(field)} differs from an input ${JSON.stringify(input)}`
          )
        }
      }
      if (!input.visible)
        throw new Error(`no visible focus ring on a text field: ${JSON.stringify(input)}`)
      await page().keyboard.press('Escape')
      await ctx.waitForTestId('connection-form', { state: 'hidden' })
    })

    await step(
      'forced colours: focus, switch states and the active tab stay visible (A11Y-02)',
      async () => {
        await page().emulateMedia({ forcedColors: 'active' })
        try {
          await sleep(300)
          await keyboardFocus(page(), page().locator(tid('workspace-connect')))
          const outline = await page()
            .locator(tid('workspace-connect'))
            .evaluate((el) => getComputedStyle(el).outlineStyle)
          const switches = await page().evaluate(() =>
            [...document.querySelectorAll('[data-slot="switch"]')].map((el) => ({
              state: el.getAttribute('data-state'),
              track: getComputedStyle(el).backgroundColor,
              thumb: getComputedStyle(el.querySelector('[data-slot="switch-thumb"]'))
                .backgroundColor
            }))
          )
          const on = switches.find((s) => s.state === 'checked')
          const off = switches.find((s) => s.state === 'unchecked')
          const tab = await page().evaluate(() => {
            const active = document.querySelector('[role="tab"][data-state="active"]')
            return active ? getComputedStyle(active).outlineStyle : null
          })
          ctx.log(`focus outline ${outline}, active tab outline ${tab}`)
          if (outline === 'none') throw new Error('the focused button has no outline')
          if (!on || !off || (on.track === off.track && on.thumb === off.thumb)) {
            throw new Error(`switch states look the same: ${JSON.stringify({ on, off })}`)
          }
          if (tab !== 'solid') throw new Error(`the active tab outline is ${tab}`)
          await ctx.shot('modes-03-forced-colors')
        } finally {
          await page().emulateMedia({ forcedColors: 'none' })
        }
      }
    )

    await step('reduced motion: dialogs open without the enter animation (A11Y-16)', async () => {
      try {
        for (const reducedMotion of ['no-preference', 'reduce']) {
          await page().emulateMedia({ reducedMotion })
          // Without the preference the dialog zooms in (≥ 50 ms: the check is not vacuous); with
          // it, a11y.css ends every animation within 1 ms and none runs once the dialog is up.
          let running = 0
          const durations = await enterAnimationDurations(page(), async () => {
            await page().locator(tid('sidebar-new-connection')).click()
            await ctx.waitForTestId('connection-form')
            running = await runningEnterAnimations(page(), 40)
          })
          await page().keyboard.press('Escape')
          await ctx.waitForTestId('connection-form', { state: 'hidden' })
          ctx.log(
            `${reducedMotion}: enter animations of ${durations.join(', ') || 'none'} s; ${running} running after 40 ms`
          )
          const slow = durations.filter((s) => s >= 0.05).length
          if (reducedMotion === 'reduce' ? slow > 0 || running > 0 : slow === 0) {
            throw new Error(
              `${reducedMotion}: enter animations ${JSON.stringify(durations)}, ${running} running`
            )
          }
        }
        const spin = await page().evaluate(() => {
          const el = document.createElement('div')
          el.className = 'animate-spin'
          document.body.append(el)
          const value = getComputedStyle(el).animationIterationCount
          el.remove()
          return value
        })
        if (spin !== 'infinite') throw new Error(`busy spinners stopped: ${spin}`)
      } finally {
        await page().emulateMedia({ reducedMotion: 'no-preference' })
      }
    })

    await step('accent-coloured text uses the contrast-safe shade (A11Y-06)', async () => {
      await openConnection(ctx, ids.live)
      for (const [dark, accent] of [
        [false, 'amber'],
        [true, 'orange']
      ]) {
        await ctx.setTheme(dark)
        const found = await accentTextScan(ctx, accent)
        ctx.log(
          `${accent} (${dark ? 'dark' : 'light'}): ${found.checked} views, ${found.offenders.length} offender(s)`
        )
        if (found.offenders.length > 0) {
          throw new Error(
            `text in the raw accent colour: ${found.offenders.slice(0, 6).join(' | ')}`
          )
        }
      }
    })
  }
}
