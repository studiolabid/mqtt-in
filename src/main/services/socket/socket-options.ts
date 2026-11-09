/**
 * What the WebSocket and Socket.IO transports derive from a profile: the URL, handshake
 * headers, TLS options and timeouts, and the conversions between payload bytes and the values
 * Socket.IO events carry.
 */
import { isIP } from 'node:net'
import { brokerUrl } from '@shared/defaults'
import { normalizeNamespace, socketSettings } from '@shared/connection-kind'
import type { ConnectionProfile } from '@shared/models'
import type { TlsMaterial } from '../mqtt/tls-material'

/** Used when the profile's connect timeout is 0 (the MQTT default as well). */
export const FALLBACK_CONNECT_TIMEOUT_MS = 30_000

export function connectTimeoutOf(profile: ConnectionProfile): number {
  return profile.connectTimeout > 0 ? profile.connectTimeout : FALLBACK_CONNECT_TIMEOUT_MS
}

/** The WebSocket URL (`ws://host:port/path`). Throws when the host is empty. */
export function websocketUrl(profile: ConnectionProfile): string {
  const host = profile.host.trim()
  if (!host) throw new Error('Host is required')
  return brokerUrl({ ...profile, host })
}

/** The Socket.IO server URL with its namespace (`http://host:port/ns`; the path is separate). */
export function socketIoUrl(profile: ConnectionProfile): string {
  const host = profile.host.trim()
  if (!host) throw new Error('Host is required')
  const scheme = profile.protocol === 'wss' || profile.protocol === 'mqtts' ? 'https' : 'http'
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const namespace = normalizeNamespace(socketSettings(profile).namespace)
  return `${scheme}://${bracketed}:${profile.port}${namespace === '/' ? '' : namespace}`
}

/** The Socket.IO path (`/socket.io/` when empty). */
export function socketIoPath(profile: ConnectionProfile): string {
  const path = profile.path.trim()
  if (path === '' || path === '/') return '/socket.io/'
  return path.startsWith('/') ? path : `/${path}`
}

/** The handshake headers (blank names skipped; a later duplicate wins). */
export function handshakeHeaders(profile: ConnectionProfile): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const { key, value } of socketSettings(profile).headers) {
    const name = key.trim()
    if (name !== '') headers[name] = value
  }
  return headers
}

export interface SocketTlsOptions {
  rejectUnauthorized: boolean
  ca?: Buffer
  cert?: Buffer
  key?: Buffer
  passphrase?: string
  servername?: string
}

/** TLS options for `wss` (`undefined` for `ws`). */
export function socketTlsOptions(
  profile: ConnectionProfile,
  material: TlsMaterial
): SocketTlsOptions | undefined {
  if (profile.protocol !== 'wss') return undefined
  const { tls } = profile
  const options: SocketTlsOptions = { rejectUnauthorized: tls.rejectUnauthorized }
  if (material.ca) options.ca = material.ca
  if (material.cert) options.cert = material.cert
  if (material.key) options.key = material.key
  if (tls.passphrase !== '') options.passphrase = tls.passphrase
  const host = profile.host.trim()
  const servername = tls.servername.trim() || (isIP(host) === 0 ? host : '')
  if (servername) options.servername = servername
  return options
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

/** The payload as text when it is valid UTF-8, `null` otherwise. */
export function utf8Text(payload: Uint8Array): string | null {
  try {
    return strictUtf8.decode(payload)
  } catch {
    return null
  }
}

/**
 * The value a Socket.IO event carries for a payload: the parsed JSON when the text is JSON
 * (an object, array, number…), the text otherwise, binary data as a Buffer.
 */
export function socketIoValue(payload: Uint8Array): unknown {
  const text = utf8Text(payload)
  if (text === null) return Buffer.from(payload)
  const trimmed = text.trim()
  if (trimmed === '') return text
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}

const encoder = new TextEncoder()

function binaryOf(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  }
  return null
}

/**
 * The payload of a received Socket.IO event: one binary argument as its bytes, one string as
 * its text, anything else as JSON (several arguments as a JSON array). An acknowledgement
 * callback (a trailing function) is left out.
 */
export function socketIoPayload(args: readonly unknown[]): Uint8Array {
  const values = typeof args.at(-1) === 'function' ? args.slice(0, -1) : args
  if (values.length === 0) return new Uint8Array(0)
  if (values.length === 1) {
    const [value] = values
    const binary = binaryOf(value)
    if (binary) return binary
    if (typeof value === 'string') return encoder.encode(value)
    return encoder.encode(JSON.stringify(value) ?? 'null')
  }
  return encoder.encode(JSON.stringify(values))
}
