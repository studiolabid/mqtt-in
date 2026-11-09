/**
 * The contract between a `SocketSession` and the transport of one connection attempt
 * (`websocket-transport`, `socketio-transport`). A transport is single-use: every attempt
 * (and every reconnect) opens a new one.
 */
import type { ConnectionProfile } from '@shared/models'
import type { TlsMaterial } from '../mqtt/tls-material'

export interface SocketTransportHandlers {
  /** The connection is open (`id` = the Socket.IO socket id). */
  onOpen(id?: string): void
  /** A received message: its topic (event name) and payload bytes. */
  onMessage(topic: string, payload: Uint8Array): void
  /**
   * The attempt failed or the open connection closed (never after `close()`). `fatal`: retrying
   * cannot help (e.g. HTTP 401, a refused auth, an untrusted certificate).
   */
  onClose(error: string, fatal: boolean): void
  /** A measured round trip in ms (WebSocket ping → pong). */
  onRtt?(ms: number): void
}

export interface SocketTransport {
  /** Sends one message; rejects with a human error when it cannot be sent. */
  send(topic: string, payload: Uint8Array): Promise<void>
  /** Closes the connection; no handler is called afterwards. */
  close(): void
}

/** Opens a transport for one attempt (injectable for tests). */
export type OpenTransport = (
  profile: ConnectionProfile,
  tls: TlsMaterial,
  handlers: SocketTransportHandlers
) => SocketTransport
