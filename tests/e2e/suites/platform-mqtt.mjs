/**
 * MQTT behaviour against the in-process aedes broker (MQTT 3.1.1 only), driven through the UI:
 * - MQ-07: an MQTT 5.0 connection (the default) fails once with 'switch this connection to MQTT
 *   3.1.1' and never loops into reconnecting;
 * - MQ-18 / MQ-09: mqtts on the plain port gives the TLS hint and growing 'Retrying in …' waits;
 * - MQ-16: a MessagePack payload authored in the publisher arrives byte-exact (64-bit integer, -0);
 * - MQ-14: a repeat job keeps running while the broker restarts on the same port.
 */
import { tid } from '../kit.mjs'
import {
  connectionProfile,
  expect,
  logRows,
  openWorkspace,
  seedConnections,
  waitFor,
  waitSession,
  workspaceStatus
} from '../lib/platform.mjs'
import {
  collectHex,
  countConnections,
  growing,
  recordEvents,
  repeatEvents,
  retryWaits,
  statusesOf
} from '../lib/platform-mqtt.mjs'

const V5_HINT = 'The broker does not support MQTT 5.0 — switch this connection to MQTT 3.1.1'
const TLS_HINT =
  /TLS handshake failed — the broker closed the connection\. Is this port TLS-enabled \(usually 8883\)\?/
/** {"id": 9007199254740993, "z": -0} as MessagePack: a uint64 and a float64 -0. */
const MSGPACK_HEX = '82a26964cf0020000000000001a17acb8000000000000000'

const errorHint = (page, text) =>
  page.locator(tid('workspace')).getByRole('button', { name: text }).first()

async function openLogs(ctx) {
  await ctx.click('workspace-tab-logs')
  await ctx.waitForTestId('log-row')
}

async function connectInWorkspace(ctx, id) {
  await openWorkspace(ctx.page, id)
  await ctx.click('workspace-connect')
}

export default {
  name: 'platform-mqtt',
  order: 24,
  broker: true,

  async run(ctx) {
    const { step, log } = ctx
    const port = ctx.broker.port

    await step('launch with saved connections', async () => {
      await ctx.launch({
        seed: seedConnections([
          connectionProfile({
            id: 'tls',
            name: 'mqtts on a plain port',
            protocol: 'mqtts',
            port,
            reconnectPeriod: 200
          }),
          connectionProfile({
            id: 'plain',
            name: 'aedes 3.1.1',
            port,
            reconnectPeriod: 200,
            subscriptions: [{ id: 's-all', topic: 'probe/#', qos: 1, enabled: true }]
          })
        ])
      })
      await recordEvents(ctx.page)
    })

    await step('an MQTT 5.0 connection to a 3.1.1 broker fails once, with a hint', async () => {
      const tcp = countConnections(ctx.broker)
      try {
        await ctx.openModal('sidebar-new-connection', 'connection-form')
        await ctx.fill('connection-name', 'MQTT 5 on aedes')
        await ctx.fill('connection-host', '127.0.0.1')
        await ctx.fill('connection-port', String(port))
        await ctx.waitForTestId('connection-version-5', { extra: '[aria-pressed="true"]' })
        await ctx.click('connection-save-connect')
        await ctx.waitForTestId('connection-form', { state: 'hidden' })
        await ctx.waitForTestId('workspace-connect', { extra: '[data-status="error"]' })
        await errorHint(ctx.page, V5_HINT).waitFor()
        await ctx.capture('mqtt-v5-on-311')
        const id = ctx.page.url().split('/connections/')[1]
        await openLogs(ctx)
        await ctx.sleep(2_500) // well past a reconnect attempt, had one been planned
        const rows = await logRows(ctx.page)
        const errors = rows.filter((row) => row.level === 'error')
        log(rows.map((row) => `${row.level}: ${row.text.slice(12, 100)}`).join(' | '))
        expect(errors.length === 1 && errors[0].text.includes(V5_HINT), 'not one error row', errors)
        expect(retryWaits(rows).length === 0, 'a retry was planned', rows)
        const statuses = await statusesOf(ctx.page, id)
        expect(!statuses.includes('reconnecting'), 'it went on reconnecting', statuses)
        expect((await workspaceStatus(ctx.page)) === 'error', 'the status left error')
        expect(tcp.count() === 1, `the broker saw ${tcp.count()} connections, not 1`)
        await ctx.click('workspace-tab-messages')
      } finally {
        tcp.stop()
      }
    })

    await step('mqtts on a plain port: the TLS hint and growing retry waits', async () => {
      await connectInWorkspace(ctx, 'tls')
      await errorHint(ctx.page, TLS_HINT).waitFor({ timeout: 10_000 })
      await openLogs(ctx)
      const rows = await waitFor(
        async () => {
          const list = await logRows(ctx.page)
          return retryWaits(list).length >= 4 ? list : null
        },
        { timeout: 20_000, label: "four 'Retrying in …' rows" }
      )
      const waits = retryWaits(rows)
      log(`waits: ${waits.join(', ')} ms`)
      expect(growing(waits), 'the waits do not grow', waits)
      expect(
        rows.some((row) => row.level === 'error' && TLS_HINT.test(row.text)),
        'no TLS hint in the log'
      )
      await ctx.shot('mqtt-tls-on-plain-port')
      await ctx.click('workspace-connect') // Reconnecting… → stops
      await waitSession(ctx.page, 'tls', (s) => s.status === 'disconnected')
      await ctx.click('workspace-tab-messages')
    })

    await step('a MessagePack payload is sent byte-exact', async () => {
      const raw = await ctx.rawClient()
      const received = await collectHex(raw, 'probe/#')
      await connectInWorkspace(ctx, 'plain')
      await ctx.waitForTestId('subscription-item', { extra: '[data-state="subscribed"]' })
      await ctx.fill('publish-topic', 'probe/msgpack')
      await ctx.page.keyboard.press('Escape')
      await ctx.click('publish-format')
      await ctx.page
        .getByRole('option', { name: /MessagePack/ })
        .first()
        .click()
      await ctx.page.locator(tid('publish-payload', ' .cm-content')).click()
      await ctx.page.keyboard.press('ControlOrMeta+A')
      await ctx.page.keyboard.insertText('{"id": 9007199254740993, "z": -0}')
      await ctx.click('publish-button')
      const message = await waitFor(
        () => received.find((entry) => entry.topic === 'probe/msgpack'),
        { timeout: 10_000, label: 'the raw subscriber to receive probe/msgpack' }
      )
      log(message.hex)
      expect(message.hex === MSGPACK_HEX, 'the bytes differ', {
        got: message.hex,
        want: MSGPACK_HEX
      })
      await ctx.waitForTestId('message-row', {
        extra: '[data-topic="probe/msgpack"][data-direction="in"]'
      })
    })

    await step('a repeat job keeps running while the broker restarts', async () => {
      const page = ctx.page
      await ctx.fill('publish-topic', 'probe/job')
      await page.keyboard.press('Escape')
      await ctx.click('publish-repeat')
      const dialog = page.getByRole('dialog', { name: 'Repeat publishing' })
      await dialog.waitFor()
      await dialog.getByRole('button', { name: '100 ms', exact: true }).click()
      await ctx.click('publish-repeat-start')
      await dialog.waitFor({ state: 'hidden' })
      const job = await waitFor(async () => (await repeatEvents(page)).at(-1), {
        label: 'the job to start'
      })
      const sent = async () =>
        (await repeatEvents(page)).filter((e) => e.jobId === job.jobId).at(-1)?.sent ?? 0
      await waitFor(async () => (await sent()) >= 3, { label: '3 messages sent' })
      await ctx.broker.close()
      await waitSession(page, 'plain', (s) => s.status === 'reconnecting')
      const during = await sent()
      await ctx.sleep(500)
      // The same port again (the closed broker's sockets may hold it for a moment).
      const restarted = await waitFor(() => ctx.startBroker({ port }).catch(() => null), {
        timeout: 10_000,
        interval: 250,
        label: `a broker listening on port ${port} again`
      })
      await waitSession(page, 'plain', (s) => s.status === 'connected', { timeout: 30_000 })
      const raw = await ctx.rawClient(restarted.url)
      const received = await collectHex(raw, 'probe/job')
      const resumed = await sent()
      await waitFor(async () => (await sent()) >= resumed + 5, { label: '5 more messages' })
      await waitFor(() => received.length > 0, { label: 'a message on the restarted broker' })
      log(`sent ${during} before the restart, ${resumed} on reconnect, ${await sent()} now`)
      await ctx.shot('mqtt-repeat-after-restart')
      const label = await page.locator(tid('publish-repeat')).first().getAttribute('aria-label')
      expect(
        /^Repeat publishing: Every 100 ms · \d+ sent$/.test(label ?? ''),
        'no live pill',
        label
      )
      const states = (await repeatEvents(page)).filter((e) => e.jobId === job.jobId)
      expect(
        states.every((e) => e.state === 'running'),
        'the job left running',
        states.at(-1)
      )
      await ctx.click('publish-repeat-stop')
      const last = await waitFor(
        async () => {
          const final = (await repeatEvents(page)).filter((e) => e.jobId === job.jobId).at(-1)
          return final?.state === 'stopped' ? final : null
        },
        { timeout: 5_000, label: 'the job to stop' }
      )
      log(`stopped after ${last.sent} messages`)
    })
  }
}
