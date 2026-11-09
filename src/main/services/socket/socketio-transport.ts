/**
 * One Socket.IO connection attempt (socket.io-client v4: servers 3.x and 4.x). The client's own
 * reconnection is off: the session retries with a new transport, like every other kind.
 * Every received event is a message on its event name (`onAny`); a publish emits its topic as
 * the event, with the payload as JSON value, text or binary (`socketIoValue`).
 */
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client'
import { parseSocketAuth, socketSettings } from '@shared/connection-kind'
import type { ConnectionProfile } from '@shared/models'
import { errorMessage, isRecord } from '../../utils/errors'
import type { TlsMaterial } from '../mqtt/tls-material'
import {
  connectTimeoutOf,
  handshakeHeaders,
  socketIoPath,
  socketIoPayload,
  socketIoUrl,
  socketIoValue,
  socketTlsOptions
} from './socket-options'
import type { SocketTransport, SocketTransportHandlers } from './types'

/** A human reason for a `connect_error`. */
function connectErrorMessage(err: Error, refused: boolean): string {
  const message = errorMessage(err).trim()
  if (refused) return `The server refused the connection: ${message || 'no reason given'}`
  const description = isRecord(err) ? err.description : undefined
  const cause = description instanceof Error ? errorMessage(description) : undefined
  if (message === 'timeout') return 'Connection timed out'
  if (/xhr poll error|websocket error/i.test(message)) {
    return cause
      ? `Cannot reach the Socket.IO server: ${cause}`
      : 'Cannot reach the Socket.IO server — check the address, port and path'
  }
  return message || 'Connection failed'
}

function options(
  profile: ConnectionProfile,
  tls: TlsMaterial
): Partial<ManagerOptions & SocketOptions> {
  const settings = socketSettings(profile)
  const secure = socketTlsOptions(profile, tls)
  const result: Partial<ManagerOptions & SocketOptions> = {
    path: socketIoPath(profile),
    forceNew: true,
    reconnection: false,
    timeout: connectTimeoutOf(profile),
    extraHeaders: handshakeHeaders(profile)
  }
  const auth = parseSocketAuth(settings.auth)
  if (auth) result.auth = auth
  if (secure) {
    result.rejectUnauthorized = secure.rejectUnauthorized
    if (secure.ca) result.ca = secure.ca.toString('utf8')
    if (secure.cert) result.cert = secure.cert.toString('utf8')
    if (secure.key) result.key = secure.key.toString('utf8')
    if (secure.passphrase) result.passphrase = secure.passphrase
  }
  return result
}

export function openSocketIo(
  profile: ConnectionProfile,
  tls: TlsMaterial,
  handlers: SocketTransportHandlers
): SocketTransport {
  let socket: Socket
  try {
    socket = io(socketIoUrl(profile), options(profile, tls))
  } catch (err) {
    // An invalid auth payload or URL: report it like a failed attempt.
    queueMicrotask(() => handlers.onClose(errorMessage(err), true))
    return { send: () => Promise.reject(new Error('Not connected')), close: () => {} }
  }
  let closed = false

  const finish = (error: string, fatal: boolean): void => {
    if (closed) return
    closed = true
    socket.removeAllListeners()
    socket.offAny()
    socket.disconnect()
    handlers.onClose(error, fatal)
  }

  socket.on('connect', () => {
    if (!closed) handlers.onOpen(socket.id)
  })

  socket.on('connect_error', (err: Error) => {
    // `active` is false when the server refused the connection (a middleware error).
    const refused = !socket.active
    finish(connectErrorMessage(err, refused), refused)
  })

  socket.on('disconnect', (reason: string) => {
    if (reason === 'io client disconnect') return
    const text =
      reason === 'io server disconnect'
        ? 'The server closed the connection'
        : reason === 'ping timeout'
          ? 'Keep-alive timeout — the server stopped responding'
          : `The connection was lost (${reason})`
    finish(text, false)
  })

  socket.onAny((event: unknown, ...args: unknown[]) => {
    if (closed || typeof event !== 'string') return
    handlers.onMessage(event, socketIoPayload(args))
  })

  return {
    send(topic, payload) {
      if (closed || !socket.connected) return Promise.reject(new Error('Not connected'))
      if (topic === '') return Promise.reject(new Error('Event name is required'))
      try {
        // Throws for reserved names (connect, disconnect…).
        socket.emit(topic, socketIoValue(payload))
      } catch (err) {
        return Promise.reject(new Error(errorMessage(err)))
      }
      return Promise.resolve()
    },
    close() {
      if (closed) return
      closed = true
      socket.removeAllListeners()
      socket.offAny()
      socket.disconnect()
    }
  }
}
