/**
 * WebSocket and Socket.IO connections, end to end against servers in this process: a connection
 * made through the dialog (Type, address, Socket options), messages from the server in the
 * list and the topic tree (WebSocket topic field, Socket.IO event names), a publish that reaches
 * the server, and the "Listening" column instead of subscriptions.
 */
import { createServer } from 'node:http'
import { Server as IoServer } from 'socket.io'
import { WebSocketServer } from 'ws'
import { tid } from '../kit.mjs'
import { showTab, treeRow, waitForRow } from '../lib/ui.mjs'

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

/** Creates a WebSocket / Socket.IO connection through the dialog and connects it. */
async function createSocketConnection(ctx, { name, kind, port, path, socket = {}, shot }) {
  const { page } = ctx
  await ctx.click('sidebar-new-connection')
  await ctx.waitForTestId('connection-form')
  await ctx.fill('connection-name', name)
  await ctx.click(`connection-kind-${kind}`)
  await ctx.waitForTestId(`connection-kind-${kind}`, { extra: '[data-state="on"]' })
  await ctx.fill('connection-host', '127.0.0.1')
  await ctx.fill('connection-port', String(port))
  await ctx.fill('connection-path', path)
  await ctx.click('connection-section-socket')
  if (socket.topicField) await ctx.fill('connection-topic-field', socket.topicField)
  if (socket.namespace) await ctx.fill('connection-namespace', socket.namespace)
  if (socket.auth) await ctx.fill('connection-socket-auth', socket.auth)
  if (shot) await ctx.shot(shot)
  await ctx.click('connection-save-connect')
  await ctx.waitForTestId('connection-form', { state: 'hidden' })
  await ctx.waitForTestId('workspace-connect', { extra: '[data-status="connected"]' })
  await page.mouse.move(1, 1)
}

async function publishFromPanel(ctx, topic, payload) {
  await ctx.fill('publish-topic', topic)
  await ctx.page.keyboard.press('Escape') // closes the topic suggestions
  await ctx.page.locator(tid('publish-payload', ' .cm-content')).click()
  await ctx.page.keyboard.press('ControlOrMeta+A')
  await ctx.page.keyboard.insertText(payload)
  await ctx.click('publish-button')
}

export default {
  name: 'ui-sockets',
  order: 67,

  async run(ctx) {
    const { step, capture } = ctx
    const wsReceived = []
    const ioReceived = []
    const wsHttp = createServer()
    const wss = new WebSocketServer({ server: wsHttp })
    wss.on('connection', (socket) => {
      socket.on('message', (data) => wsReceived.push(data.toString('utf8')))
    })
    const ioHttp = createServer()
    const io = new IoServer(ioHttp)
    io.of('/plant').on('connection', (socket) => {
      socket.onAny((event, ...args) => ioReceived.push({ event, args }))
    })
    const wsPort = await listen(wsHttp)
    const ioPort = await listen(ioHttp)

    try {
      await step('a WebSocket connection made in the dialog receives and sends', async () => {
        await ctx.launch({ size: { width: 1280, height: 800 } })
        await createSocketConnection(ctx, {
          name: 'Live feed',
          kind: 'websocket',
          port: wsPort,
          path: '/',
          socket: { topicField: 'type' }
        })
        await ctx.waitForTestId('socket-listen-panel')
        await ctx.waitForTestId('connection-kind-badge')
        if ((await ctx.page.locator(tid('subscription-panel')).count()) !== 0)
          throw new Error('a WebSocket workspace shows subscriptions')
        for (const client of wss.clients) {
          client.send(JSON.stringify({ type: 'temperature', value: 21.5 }))
          client.send('hello from the server')
        }
        await waitForRow(ctx, 'temperature', 'in')
        await waitForRow(ctx, 'message', 'in')
        if ((await ctx.page.locator(tid('publish-qos')).count()) !== 0)
          throw new Error('the publisher offers QoS for a WebSocket connection')
        await publishFromPanel(ctx, 'message', '{"cmd":"status"}')
        await waitForRow(ctx, 'message', 'out')
        for (let i = 0; i < 50 && wsReceived.length === 0; i++) await ctx.page.waitForTimeout(50)
        if (wsReceived[0] !== '{"cmd":"status"}')
          throw new Error(`the server received ${JSON.stringify(wsReceived)}`)
        await capture('sockets-01-websocket')
      })

      await step('a Socket.IO connection shows event names as topics and emits', async () => {
        await createSocketConnection(ctx, {
          name: 'Plant events',
          kind: 'socketio',
          port: ioPort,
          path: '/socket.io/',
          socket: { namespace: '/plant', auth: '{"token":"e2e"}' },
          shot: 'sockets-00-dialog'
        })
        io.of('/plant').emit('status', { state: 'on', level: 3 })
        io.of('/plant').emit('alarm', 'door open')
        await waitForRow(ctx, 'status', 'in')
        await waitForRow(ctx, 'alarm', 'in')
        await publishFromPanel(ctx, 'cmd', '{"id":203,"cmd":"status"}')
        await waitForRow(ctx, 'cmd', 'out')
        for (let i = 0; i < 50 && ioReceived.length === 0; i++) await ctx.page.waitForTimeout(50)
        const first = JSON.stringify(ioReceived[0])
        if (first !== '{"event":"cmd","args":[{"id":203,"cmd":"status"}]}')
          throw new Error(`the server received ${first}`)
        await showTab(ctx, 'topics')
        await treeRow(ctx, 'status')
        await capture('sockets-02-socketio-topics')
      })
    } finally {
      for (const client of wss.clients) client.terminate()
      wss.close()
      wsHttp.close()
      await new Promise((resolve) => io.close(() => resolve()))
    }
  }
}
