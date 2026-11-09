/**
 * WebSocket and Socket.IO connections against in-process servers (`ws`, `socket.io`), through
 * `MqttManager`: status, received messages and their topics, sending, handshake headers,
 * subprotocols and auth, reconnects, fatal refusals and "Test connection".
 */
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server as IoServer } from 'socket.io'
import { WebSocketServer, type WebSocket } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import type { ConnectionKind, ConnectionProfile, SocketSettings } from '@shared/models'
import { utf8Decode, utf8Encode } from '@shared/payload'
import { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import { testSocketConnection } from '../../../src/main/services/socket/socket-test'
import { createRecorder, type Recorder, waitFor } from './helpers/broker'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function listen(server: HttpServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  )
  return (server.address() as AddressInfo).port
}

interface WsHarness {
  port: number
  wss: WebSocketServer
  clients: WebSocket[]
  received: Array<{ data: string | Buffer; binary: boolean }>
  requests: Array<{ headers: Record<string, unknown>; protocol: string }>
}

async function startWs(
  verify?: (headers: Record<string, unknown>) => number | null
): Promise<WsHarness> {
  const http = createServer()
  const harness: WsHarness = {
    port: 0,
    wss: new WebSocketServer({
      server: http,
      verifyClient: (info, done) => {
        const status = verify?.(info.req.headers) ?? null
        if (status === null) done(true)
        else done(false, status)
      }
    }),
    clients: [],
    received: [],
    requests: []
  }
  harness.wss.on('connection', (socket, req) => {
    harness.clients.push(socket)
    harness.requests.push({ headers: req.headers, protocol: socket.protocol })
    socket.on('message', (data, binary) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      harness.received.push({ data: binary ? buffer : buffer.toString('utf8'), binary })
    })
  })
  cleanups.push(() => {
    for (const client of harness.wss.clients) client.terminate()
    harness.wss.close()
  })
  harness.port = await listen(http)
  return harness
}

interface IoHarness {
  port: number
  io: IoServer
  received: Array<{ event: string; args: unknown[] }>
  auth: unknown[]
}

async function startIo(namespace = '/'): Promise<IoHarness> {
  const http = createServer()
  const io = new IoServer(http)
  const harness: IoHarness = { port: 0, io, received: [], auth: [] }
  io.of(namespace).use((socket, next) => {
    harness.auth.push(socket.handshake.auth)
    if ((socket.handshake.auth as { token?: string }).token === 'bad') {
      next(new Error('not authorized'))
      return
    }
    next()
  })
  io.of(namespace).on('connection', (socket) => {
    socket.onAny((event: string, ...args: unknown[]) => harness.received.push({ event, args }))
  })
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        io.close(() => resolve())
      })
  )
  harness.port = await listen(http)
  return harness
}

function setup(
  kind: ConnectionKind,
  port: number,
  overrides: Partial<ConnectionProfile> = {},
  socket: Partial<SocketSettings> = {}
): { profile: ConnectionProfile; recorder: Recorder; manager: MqttManager } {
  const profile = createConnectionProfile({
    kind,
    host: '127.0.0.1',
    port,
    protocol: 'ws',
    path: kind === 'socketio' ? '/socket.io/' : '/',
    autoReconnect: false,
    socket: { headers: [], subprotocols: '', namespace: '/', auth: '', topicField: '', ...socket },
    ...overrides
  })
  const recorder = createRecorder()
  const manager = new MqttManager({
    profiles: { get: (id) => (id === profile.id ? profile : undefined) },
    sink: recorder.sink,
    batcher: { intervalMs: 5 }
  })
  cleanups.push(() => manager.disposeAll(1000))
  return { profile, recorder, manager }
}

const statusOf = (recorder: Recorder): string | undefined => recorder.status.at(-1)?.status

const waitStatus = (recorder: Recorder, status: string, timeoutMs = 4000): Promise<true> =>
  waitFor(() => recorder.status.some((s) => s.status === status), timeoutMs, status)

const incoming = (recorder: Recorder): Array<{ topic: string; text: string }> =>
  recorder.messages
    .filter((m) => m.direction === 'in')
    .map((m) => ({ topic: m.topic, text: utf8Decode(m.payload) }))

describe('WebSocket connections', () => {
  it('connects with headers and a subprotocol, receives and sends messages', async () => {
    const server = await startWs()
    const { profile, recorder, manager } = setup(
      'websocket',
      server.port,
      { keepalive: 0 },
      {
        headers: [{ key: 'Authorization', value: 'Bearer abc' }],
        subprotocols: 'json, v2',
        topicField: 'type'
      }
    )
    await manager.connect(profile.id)
    await waitStatus(recorder, 'connected')
    expect(server.requests[0].headers.authorization).toBe('Bearer abc')
    expect(server.requests[0].protocol).toBe('json')
    expect(manager.getSessions()[0]).toMatchObject({ status: 'connected', subscriptions: [] })

    const client = await waitFor(() => server.clients[0])
    client.send(JSON.stringify({ type: 'temperature', value: 21 }))
    client.send('plain text')
    client.send(Buffer.from([1, 2, 3]), { binary: true })
    await waitFor(() => recorder.messages.length >= 3)
    expect(incoming(recorder).map((m) => m.topic)).toEqual(['temperature', 'message', 'message'])
    expect(incoming(recorder)[0].text).toBe('{"type":"temperature","value":21}')
    expect(recorder.messages[2].payload).toEqual(new Uint8Array([1, 2, 3]))

    await manager.publish(profile.id, {
      topic: 'message',
      payload: utf8Encode('{"cmd":"status"}'),
      qos: 0,
      retain: false
    })
    await manager.publish(profile.id, {
      topic: 'message',
      payload: new Uint8Array([0xff, 0x00]),
      qos: 0,
      retain: false
    })
    await waitFor(() => server.received.length >= 2)
    expect(server.received[0]).toEqual({ data: '{"cmd":"status"}', binary: false })
    expect(server.received[1].binary).toBe(true)
    await waitFor(() => recorder.messages.filter((m) => m.direction === 'out').length === 2)

    await expect(manager.subscribe(profile.id, createSubscription({ topic: '#' }))).rejects.toThrow(
      /only for MQTT/
    )

    await manager.disconnect(profile.id)
    expect(statusOf(recorder)).toBe('disconnected')
  })

  it('reconnects after the server drops the connection', async () => {
    const server = await startWs()
    const { profile, recorder, manager } = setup('websocket', server.port, {
      autoReconnect: true,
      reconnectPeriod: 100,
      keepalive: 0
    })
    await manager.connect(profile.id)
    await waitStatus(recorder, 'connected')
    server.clients[0].terminate()
    await waitStatus(recorder, 'reconnecting')
    await waitFor(() => server.clients.length === 2, 4000, 'second connection')
    await waitFor(() => statusOf(recorder) === 'connected')
  })

  it('stops at a refused handshake (HTTP 401) instead of retrying', async () => {
    const server = await startWs(() => 401)
    const { profile, recorder, manager } = setup('websocket', server.port, {
      autoReconnect: true,
      reconnectPeriod: 100
    })
    await manager.connect(profile.id)
    await waitStatus(recorder, 'error')
    expect(recorder.status.at(-1)?.error).toMatch(/HTTP 401/)
    expect(recorder.status.some((s) => s.status === 'reconnecting')).toBe(false)
  })

  it('tests a connection without keeping it', async () => {
    const server = await startWs()
    const { profile } = setup('websocket', server.port)
    const ok = await testSocketConnection(profile)
    expect(ok).toMatchObject({ ok: true, message: 'Connected' })
    const closed = setup('websocket', 1, { connectTimeout: 2000 }).profile
    const failed = await testSocketConnection(closed)
    expect(failed.ok).toBe(false)
  })
})

describe('Socket.IO connections', () => {
  it('receives every event on its name and emits JSON values', async () => {
    const server = await startIo('/plant')
    const { profile, recorder, manager } = setup(
      'socketio',
      server.port,
      {},
      { namespace: 'plant', auth: '{"token":"good"}' }
    )
    await manager.connect(profile.id)
    await waitStatus(recorder, 'connected')
    expect(server.auth[0]).toEqual({ token: 'good' })
    const connected = recorder.status.find((s) => s.status === 'connected')
    expect(connected?.clientId).toBeTruthy()

    server.io.of('/plant').emit('status', { state: 'on', level: 3 })
    server.io.of('/plant').emit('note', 'hello')
    server.io.of('/plant').emit('pair', 1, 'two')
    server.io.of('/plant').emit('blob', Buffer.from([9, 8]))
    await waitFor(() => recorder.messages.length >= 4)
    expect(incoming(recorder).slice(0, 3)).toEqual([
      { topic: 'status', text: '{"state":"on","level":3}' },
      { topic: 'note', text: 'hello' },
      { topic: 'pair', text: '[1,"two"]' }
    ])
    expect(recorder.messages[3].payload).toEqual(new Uint8Array([9, 8]))

    await manager.publish(profile.id, {
      topic: 'cmd',
      payload: utf8Encode('{"id":203,"cmd":"status"}'),
      qos: 0,
      retain: false
    })
    await manager.publish(profile.id, {
      topic: 'say',
      payload: utf8Encode('just text'),
      qos: 0,
      retain: false
    })
    await waitFor(() => server.received.length >= 2)
    expect(server.received).toEqual([
      { event: 'cmd', args: [{ id: 203, cmd: 'status' }] },
      { event: 'say', args: ['just text'] }
    ])
    await expect(
      manager.publish(profile.id, {
        topic: 'connect',
        payload: utf8Encode('1'),
        qos: 0,
        retain: false
      })
    ).rejects.toThrow(/reserved/)
  })

  it('ends with the server’s refusal of the auth payload', async () => {
    const server = await startIo()
    const { profile, recorder, manager } = setup(
      'socketio',
      server.port,
      { autoReconnect: true, reconnectPeriod: 100 },
      { auth: '{"token":"bad"}' }
    )
    await manager.connect(profile.id)
    await waitStatus(recorder, 'error')
    expect(recorder.status.at(-1)?.error).toMatch(/refused the connection: not authorized/)
    expect(recorder.status.some((s) => s.status === 'reconnecting')).toBe(false)
  })

  it('tests a connection', async () => {
    const server = await startIo()
    const { profile } = setup('socketio', server.port)
    const result = await testSocketConnection(profile)
    expect(result.ok).toBe(true)
    expect(result.clientId).not.toBe('')
  })
})
