/**
 * One WebSocket connection attempt (`ws`): handshake headers, subprotocols, TLS, a handshake
 * timeout and a ping every keep-alive interval that measures the round trip and detects a dead
 * server. Text messages get their topic from the profile's topic field
 * (`websocketTopic`); binary ones are on `message`. Valid UTF-8 payloads are sent as text
 * frames, anything else as binary frames.
 */
import WebSocket, { type ClientOptions, type RawData } from 'ws'
import {
  parseSubprotocols,
  socketSettings,
  websocketTopic,
  WS_MESSAGE_TOPIC
} from '@shared/connection-kind'
import type { ConnectionProfile } from '@shared/models'
import { errorMessage } from '../../utils/errors'
import { describeError } from '../mqtt/transport-errors'
import type { TlsMaterial } from '../mqtt/tls-material'
import {
  connectTimeoutOf,
  handshakeHeaders,
  socketTlsOptions,
  utf8Text,
  websocketUrl
} from './socket-options'
import type { SocketTransport, SocketTransportHandlers } from './types'

/** A close forced after a graceful one took this long. */
export const CLOSE_TIMEOUT_MS = 2000
/** Received messages larger than this close the connection (ws' own limit is 100 MiB). */
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024

/** HTTP answers to the handshake that another attempt cannot change. */
const FATAL_STATUS = new Set([400, 401, 403, 404, 405, 410, 426])

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))
  // Copy: pooled Node buffers would otherwise be serialized whole over IPC.
  return new Uint8Array(data)
}

/** The human reason a close code stands for (`1000` normal closes are not errors). */
function closeReason(code: number, reason: string): string {
  const detail = reason.trim()
  if (code === 1000 || code === 1005) {
    return detail
      ? `The server closed the connection: ${detail}`
      : 'The server closed the connection'
  }
  if (code === 1006) return 'The connection was lost'
  return `The server closed the connection (code ${code}${detail ? `: ${detail}` : ''})`
}

export function openWebSocket(
  profile: ConnectionProfile,
  tls: TlsMaterial,
  handlers: SocketTransportHandlers
): SocketTransport {
  const settings = socketSettings(profile)
  const host = profile.host.trim()
  const ctx = { host, port: profile.port, protocol: profile.protocol }
  const options: ClientOptions = {
    headers: handshakeHeaders(profile),
    handshakeTimeout: connectTimeoutOf(profile),
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: true,
    ...socketTlsOptions(profile, tls)
  }
  const protocols = parseSubprotocols(settings.subprotocols)
  let socket: WebSocket
  try {
    socket = new WebSocket(websocketUrl(profile), protocols, options)
  } catch (err) {
    // An invalid URL or header throws synchronously: report it like a failed attempt.
    queueMicrotask(() => handlers.onClose(errorMessage(err), true))
    return { send: () => Promise.reject(new Error('Not connected')), close: () => {} }
  }

  let closed = false
  let lastError: { message: string; fatal: boolean } | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let pingSentAt: number | undefined

  const stopPing = (): void => {
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = undefined
  }

  const startPing = (): void => {
    const intervalMs = profile.keepalive * 1000
    if (!(intervalMs > 0)) return
    pingTimer = setInterval(() => {
      if (pingSentAt !== undefined) {
        // No pong for a whole interval: the server is gone (a half-open TCP connection).
        lastError = { message: 'Keep-alive timeout — the server stopped responding', fatal: false }
        socket.terminate()
        return
      }
      pingSentAt = performance.now()
      socket.ping()
    }, intervalMs)
  }

  socket.on('open', () => {
    if (closed) return
    startPing()
    handlers.onOpen()
  })

  socket.on('pong', () => {
    if (pingSentAt === undefined) return
    const ms = performance.now() - pingSentAt
    pingSentAt = undefined
    handlers.onRtt?.(Math.round(ms * 10) / 10)
  })

  socket.on('message', (data: RawData, isBinary: boolean) => {
    if (closed) return
    const payload = toBytes(data)
    const topic = isBinary
      ? WS_MESSAGE_TOPIC
      : websocketTopic(utf8Text(payload), settings.topicField)
    handlers.onMessage(topic, payload)
  })

  socket.on('error', (err: Error) => {
    const status = /Unexpected server response: (\d+)/.exec(err.message)
    lastError = {
      message: describeError(err, ctx),
      fatal:
        (status !== null && FATAL_STATUS.has(Number(status[1]))) ||
        /self[- ]signed|certificate|unable to verify/i.test(err.message)
    }
  })

  socket.on('close', (code: number, reason: Buffer) => {
    stopPing()
    if (closed) return
    closed = true
    const error = lastError ?? { message: closeReason(code, reason.toString('utf8')), fatal: false }
    handlers.onClose(error.message, error.fatal)
  })

  return {
    send(_topic, payload) {
      if (closed || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('Not connected'))
      }
      const text = utf8Text(payload)
      return new Promise<void>((resolve, reject) => {
        socket.send(text ?? payload, { binary: text === null }, (err) => {
          if (err) reject(new Error(describeError(err, ctx)))
          else resolve()
        })
      })
    },
    close() {
      if (closed) return
      closed = true
      stopPing()
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.terminate()
        return
      }
      socket.close(1000)
      setTimeout(() => socket.terminate(), CLOSE_TIMEOUT_MS).unref()
    }
  }
}
