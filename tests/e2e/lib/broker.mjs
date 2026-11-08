/**
 * In-process MQTT broker (aedes, MQTT 3.1.1) and raw mqtt.js clients for e2e suites.
 */
import { createServer } from 'node:net'
import { Aedes } from 'aedes'
import mqtt from 'mqtt'
import { sleep } from './processes.mjs'

const CLOSE_TIMEOUT = 5_000

/** Resolves `promise`, or undefined after `ms` (a close that hangs never blocks the run). */
const settle = (promise, ms = CLOSE_TIMEOUT) => Promise.race([promise, sleep(ms)])

/** A free TCP port on 127.0.0.1 (free when checked; listen on port 0 where you can). */
export async function freePort() {
  const probe = createServer()
  await new Promise((done) => probe.listen(0, '127.0.0.1', done))
  const { port } = probe.address()
  await new Promise((done) => probe.close(done))
  return port
}

/**
 * Starts an aedes broker on 127.0.0.1.
 *
 * @param {object} [options]
 * @param {Function} [options.authenticate] aedes hook `(client, username, password, done)`;
 *   refuse with `done(Object.assign(new Error('…'), { returnCode: 4 }), false)`.
 * @param {number} [options.port] a fixed port (e.g. the port of a broker you just closed);
 *   default: a free one.
 * @returns {Promise<{ port: number, url: string, broker: object, server: object,
 *   clients: () => string[], close: () => Promise<void> }>}
 */
export async function startBroker({ authenticate, port = 0 } = {}) {
  const broker = await Aedes.createBroker(authenticate ? { authenticate } : {})
  const server = createServer(broker.handle)
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail)
      done()
    })
  })
  const actual = server.address().port
  let closing = null
  return {
    port: actual,
    url: `mqtt://127.0.0.1:${actual}`,
    broker,
    server,
    clients: () => Object.keys(broker.clients),
    close() {
      closing ??= (async () => {
        // Stop accepting first (the app reconnects at once), then drop the clients.
        const serverClosed = new Promise((done) => server.close(() => done()))
        await settle(new Promise((done) => broker.close(() => done())))
        for (const socket of sockets) socket.destroy()
        await settle(serverClosed)
      })()
      return closing
    }
  }
}

/**
 * A connected mqtt.js client (MQTT 3.1.1 unless `options.protocolVersion` says otherwise) with a
 * promise-based `close()` that never hangs.
 */
export async function rawClient(url, options = {}) {
  const client = await mqtt.connectAsync(url, {
    protocolVersion: 4,
    connectTimeout: 10_000,
    ...options
  })
  let closing = null
  client.close = () => {
    closing ??= (async () => {
      await settle(client.endAsync(), 3_000)
      if (!client.disconnected) client.end(true)
    })()
    return closing
  }
  return client
}
