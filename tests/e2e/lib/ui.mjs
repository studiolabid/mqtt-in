/**
 * Flows shared by the ui-* suites (tests/e2e/suites/ui-*.mjs): a connection created and connected
 * through the dialog, subscriptions, raw publishes, the command palette, the focused element and
 * the topic tree. Everything is driven through data-testid hooks (or roles and labels where a
 * component has no hook) and acts on the suite's current app (`ctx.page` / `ctx.app`).
 */
import { sleep, tid } from '../kit.mjs'

/**
 * Creates a connection through the dialog and, unless `connect` is false, connects it and waits
 * for `status` ('connected' by default; e.g. 'error' for MQTT 5 against aedes). MQTT 3.1.1 by
 * default (aedes speaks 3.1.1 only). Resolves the connection id (the workspace route).
 *
 * @param {object} ctx the suite context
 * @param {{ name?: string, host?: string, port?: number, version?: 3|4|5, connect?: boolean,
 *   status?: string, keepalive?: number, username?: string, password?: string }} [options]
 */
export async function createConnection(ctx, options = {}) {
  const { name = 'E2E broker', host = '127.0.0.1', version = 4, connect = true } = options
  const status = options.status ?? 'connected'
  const port = options.port ?? ctx.broker?.port
  const { page } = ctx
  await ctx.click('sidebar-new-connection')
  await ctx.waitForTestId('connection-form')
  await ctx.fill('connection-name', name)
  await ctx.fill('connection-host', host)
  await ctx.fill('connection-port', String(port))
  await ctx.click(`connection-version-${version}`)
  await ctx.waitForTestId(`connection-version-${version}`, { extra: '[aria-pressed="true"]' })
  if (options.username !== undefined || options.password !== undefined) {
    await ctx.click('connection-section-auth')
    if (options.username !== undefined) await ctx.fill('connection-username', options.username)
    if (options.password !== undefined) await ctx.fill('connection-password', options.password)
  }
  if (options.keepalive !== undefined) {
    await ctx.click('connection-section-advanced')
    await page.getByLabel('Keep alive', { exact: true }).fill(String(options.keepalive))
  }
  await ctx.click(connect ? 'connection-save-connect' : 'connection-save')
  await ctx.waitForTestId('connection-form', { state: 'hidden' })
  await page.waitForFunction(() => location.hash.startsWith('#/connections/'))
  if (connect) await ctx.waitForTestId('workspace-connect', { extra: `[data-status="${status}"]` })
  await page.mouse.move(1, 1)
  return connectionId(page)
}

/** The id of the connection whose workspace is shown (from the route). */
export const connectionId = (page) =>
  page.evaluate(() => decodeURIComponent(location.hash.split('/').pop() ?? ''))

/** The sidebar row of a connection, by id. */
export const connectionItem = (page, id) =>
  page.locator(tid('connection-item', `[data-connection-id="${id}"]`))

/** Opens a connection's workspace from the sidebar. */
export async function openConnection(ctx, id) {
  await connectionItem(ctx.page, id).locator('button[data-nav]').click()
  await ctx.page.waitForFunction(
    (target) => decodeURIComponent(location.hash.split('/').pop() ?? '') === target,
    id
  )
  await ctx.waitForTestId('workspace')
  await ctx.page.mouse.move(1, 1)
}

/** Adds a subscription through the dialog and waits until the broker granted it. */
export async function subscribe(ctx, topic = '#') {
  const rows = ctx.page.locator(tid('subscription-item', '[data-state="subscribed"]'))
  const before = await rows.count()
  await ctx.click('subscription-add')
  await ctx.waitForTestId('subscription-dialog')
  await ctx.fill('subscription-topic', topic)
  await ctx.click('subscription-save')
  await ctx.waitForTestId('subscription-dialog', { state: 'hidden' })
  await ctx.page.waitForFunction(
    ({ selector, count }) => document.querySelectorAll(selector).length > count,
    { selector: tid('subscription-item', '[data-state="subscribed"]'), count: before }
  )
  await ctx.page.mouse.move(1, 1)
}

/** Publishes payloads from a raw mqtt.js client (QoS 0 unless `options.qos`), in order. */
export async function publishAll(client, topic, payloads, options = {}) {
  for (const payload of payloads) await client.publishAsync(topic, payload, { qos: 0, ...options })
}

/** Waits for a message row of `topic` (optionally of one direction). */
export async function waitForRow(ctx, topic, direction) {
  const extra = `[data-topic="${topic}"]${direction ? `[data-direction="${direction}"]` : ''}`
  return ctx.waitForTestId('message-row', { extra })
}

/**
 * The focused element, described: its data-testid, else `tag#id:<label or text>`, or 'BODY'
 * when focus fell back to the page.
 */
export const activeElement = (page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'BODY'
    const id = el.getAttribute('data-testid')
    if (id) return id
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}:${label}`
  })

/** Waits (up to `ms`) until the focused element's description matches; resolves it. */
export async function waitForFocus(page, test, ms = 3_000) {
  const ok = typeof test === 'function' ? test : (value) => value === test
  const until = Date.now() + ms
  let value = await activeElement(page)
  while (!ok(value) && Date.now() < until) {
    await sleep(50)
    value = await activeElement(page)
  }
  if (!ok(value)) throw new Error(`focus is on "${value}", expected ${String(test)}`)
  return value
}

/** Gives the next focus() the keyboard modality (so :focus-visible matches) and focuses. */
export async function keyboardFocus(page, locator) {
  await page.keyboard.press('Shift')
  await locator.focus()
  return locator.evaluate((el) => el.matches(':focus-visible'))
}

/** Opens the command palette with Ctrl+K and types `text`. */
export async function openPalette(ctx, text = '') {
  await ctx.page.keyboard.press('Control+K')
  await ctx.waitForTestId('command-palette')
  if (text) await ctx.page.keyboard.type(text, { delay: 5 })
  await sleep(150)
}

/** The palette's options whose text contains `label`. */
export const paletteOption = (page, label) =>
  page.locator(`${tid('command-palette')} [role="option"]`, { hasText: label })

/** Opens the palette, searches `text` and runs the highlighted entry (Enter). */
export async function runPalette(ctx, text) {
  await openPalette(ctx, text)
  await ctx.page.keyboard.press('Enter')
  await ctx.waitForTestId('command-palette', { state: 'hidden' })
}

/** Shows a workspace tab (Messages / Topics / Logs). */
export async function showTab(ctx, tab) {
  await ctx.click(`workspace-tab-${tab}`)
  await ctx.waitForTestId(`workspace-tab-${tab}`, { extra: '[data-state="active"]' })
  await sleep(150)
}

/** The topic tree row of `topic`: the tree is filtered to it first (rows are virtualized). */
export async function treeRow(ctx, topic) {
  await ctx.fill('topic-search', topic)
  const row = ctx.page.locator(tid('topic-row', `[data-topic="${topic}"]`))
  await row.waitFor({ timeout: 10_000 })
  return row
}

/** Clears the topic tree search. */
export async function clearTreeSearch(ctx) {
  await ctx.fill('topic-search', '')
  await sleep(300)
}

/** Text of every toast on screen. */
export const toastTexts = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-sonner-toast]')].map((toast) =>
      (toast.textContent ?? '').replace(/\s+/g, ' ').trim()
    )
  )

/** Waits for a toast containing `text`; resolves its locator. */
export async function waitForToast(page, text, timeout = 10_000) {
  const toast = page.locator('[data-sonner-toast]', { hasText: text }).last()
  await toast.waitFor({ timeout })
  return toast
}

/** Closes every toast (their close buttons) and waits until none is left. */
export async function dismissToasts(page) {
  for (let i = 0; i < 12; i++) {
    const close = page.locator('[data-sonner-toast] [data-close-button]').first()
    if ((await close.count()) === 0) break
    await close.click({ force: true }).catch(() => undefined)
    await sleep(120)
  }
  await page
    .waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0, null, {
      timeout: 5_000
    })
    .catch(() => undefined)
  await page.mouse.move(1, 1)
}

/**
 * Sends a storage notice from main, as the storage layer does (`app:event:storage-notice`): a
 * deterministic way to raise a toast (an error toast that stays until dismissed). Each call
 * names its own file: notices about the same file replace each other.
 */
let noticeSeq = 0
export async function pushStorageNotice(app, message) {
  noticeSeq += 1
  await app.evaluate(
    ({ BrowserWindow }, notice) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('app:event:storage-notice', notice)
      }
    },
    {
      kind: 'write-failed',
      file: `e2e-${noticeSeq}.json`,
      message,
      timestamp: Date.now() + noticeSeq
    }
  )
}

/** Sends a status event from main as the MQTT session does (`mqtt:event:status`). */
export async function pushStatus(app, event) {
  await app.evaluate(
    ({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0].webContents.send('mqtt:event:status', payload)
    },
    { timestamp: Date.now(), ...event }
  )
}

/**
 * Holds the next calls of a stubbed dialog (e.g. 'showSaveDialog') pending, so a test can look at
 * the app while it waits for "the user". The replacement is a stub too (it records the call and
 * never opens anything); release(result) answers every pending call and puts the kit's stub back.
 */
export async function holdDialog(app, method) {
  await app.evaluate(({ dialog }, name) => {
    const state = globalThis.__mqteyE2E
    const kitStub = state.stubs[`dialog.${name}`]
    if (typeof kitStub !== 'function' || dialog[name] !== kitStub) {
      throw new Error(`dialog.${name} is not the kit's stub`)
    }
    const hold = { pending: [], kitStub }
    ;(state.holds ??= {})[name] = hold
    dialog[name] = (...args) => {
      state.calls.push({ name: `dialog.${name}`, args: args.map(() => '[held]'), at: Date.now() })
      return new Promise((resolve) => hold.pending.push(resolve))
    }
  }, method)
  return {
    /** Calls waiting for an answer. */
    pending: () =>
      app.evaluate((_e, name) => globalThis.__mqteyE2E.holds[name].pending.length, method),
    release: (result) =>
      app.evaluate(
        ({ dialog }, { name, value }) => {
          const hold = globalThis.__mqteyE2E.holds[name]
          dialog[name] = hold.kitStub
          for (const resolve of hold.pending.splice(0)) resolve(value)
        },
        { name: method, value: result }
      )
  }
}
