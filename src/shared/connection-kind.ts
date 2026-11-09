/**
 * Connection kinds (MQTT, WebSocket, Socket.IO): labels, defaults and the helpers every process
 * uses to tell them apart. Pure: safe in main, preload and renderer.
 */
import type { ConnectionKind, ConnectionProfile, MqttProtocol, SocketSettings } from './models'

export const CONNECTION_KINDS: readonly ConnectionKind[] = ['mqtt', 'websocket', 'socketio']

export const KIND_LABELS: Readonly<Record<ConnectionKind, string>> = {
  mqtt: 'MQTT',
  websocket: 'WebSocket',
  socketio: 'Socket.IO'
}

/** The topic of a WebSocket message without a topic field (see `SocketSettings.topicField`). */
export const WS_MESSAGE_TOPIC = 'message'

/** Default WebSocket path per kind (`/mqtt` is the MQTT-over-WebSocket convention). */
export const KIND_DEFAULT_PATHS: Readonly<Record<ConnectionKind, string>> = {
  mqtt: '/mqtt',
  websocket: '/',
  socketio: '/socket.io/'
}

/** Read only: copy it (`socketSettings`) before editing. */
export const DEFAULT_SOCKET_SETTINGS: Readonly<SocketSettings> = {
  headers: [],
  subprotocols: '',
  namespace: '/',
  auth: '',
  topicField: ''
}

export function isConnectionKind(value: unknown): value is ConnectionKind {
  return value === 'mqtt' || value === 'websocket' || value === 'socketio'
}

/** The profile's kind (`mqtt` when missing). */
export function connectionKind(profile: Pick<ConnectionProfile, 'kind'>): ConnectionKind {
  return profile.kind ?? 'mqtt'
}

/** True for MQTT profiles (also those saved before connection kinds existed). */
export function isMqttProfile(profile: Pick<ConnectionProfile, 'kind'>): boolean {
  return connectionKind(profile) === 'mqtt'
}

/** The profile's socket settings with the defaults filled in (a fresh copy). */
export function socketSettings(profile: Pick<ConnectionProfile, 'socket'>): SocketSettings {
  const socket = profile.socket
  return {
    headers: (socket?.headers ?? []).map((header) => ({ ...header })),
    subprotocols: socket?.subprotocols ?? DEFAULT_SOCKET_SETTINGS.subprotocols,
    namespace: socket?.namespace || DEFAULT_SOCKET_SETTINGS.namespace,
    auth: socket?.auth ?? DEFAULT_SOCKET_SETTINGS.auth,
    topicField: socket?.topicField ?? DEFAULT_SOCKET_SETTINGS.topicField
  }
}

/** The protocols a kind can use: WebSocket and Socket.IO only run over `ws` / `wss`. */
export function protocolsOf(kind: ConnectionKind): readonly MqttProtocol[] {
  return kind === 'mqtt' ? ['mqtt', 'mqtts', 'ws', 'wss'] : ['ws', 'wss']
}

/** The protocol to use after switching to `kind`: the closest one it supports. */
export function protocolForKind(kind: ConnectionKind, protocol: MqttProtocol): MqttProtocol {
  if (kind === 'mqtt') return protocol
  if (protocol === 'mqtt') return 'ws'
  if (protocol === 'mqtts') return 'wss'
  return protocol
}

/** Splits a comma separated subprotocol list (blank entries dropped). */
export function parseSubprotocols(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/** A Socket.IO namespace with its leading slash (`admin` → `/admin`, empty → `/`). */
export function normalizeNamespace(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * The `auth` payload of a Socket.IO connection: the parsed JSON object, `undefined` when empty.
 * Throws a human error for anything but a JSON object.
 */
export function parseSocketAuth(value: string): Record<string, unknown> | undefined {
  if (value.trim() === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Auth must be a JSON object, e.g. {"token":"…"}')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Auth must be a JSON object, e.g. {"token":"…"}')
  }
  return parsed as Record<string, unknown>
}

/**
 * The topic of an incoming WebSocket text message: the value of `field` when the message is a
 * JSON object with a string or number there, `WS_MESSAGE_TOPIC` otherwise.
 */
export function websocketTopic(text: string | null, field: string): string {
  const key = field.trim()
  if (key === '' || text === null) return WS_MESSAGE_TOPIC
  const start = text.trimStart()
  if (!start.startsWith('{')) return WS_MESSAGE_TOPIC
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return WS_MESSAGE_TOPIC
    const value = (parsed as Record<string, unknown>)[key]
    if (typeof value === 'string' && value !== '') return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  } catch {
    // Not JSON: the default topic.
  }
  return WS_MESSAGE_TOPIC
}

/** An HTTP token (RFC 9110): header names and WebSocket subprotocols. */
const HTTP_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** Why `name: value` cannot be sent as a handshake header, or `null` when it can. */
export function headerProblem(name: string, value: string): string | null {
  if (name.trim() === '') return 'Header name is required'
  if (!HTTP_TOKEN.test(name.trim())) return `Header name "${name}" has invalid characters`
  if (/[\r\n\0]/.test(value)) return `Header "${name}" must be a single line`
  return null
}

/** Why a subprotocol list cannot be sent, or `null` when it can. */
export function subprotocolsProblem(value: string): string | null {
  const bad = parseSubprotocols(value).find((entry) => !HTTP_TOKEN.test(entry))
  return bad === undefined ? null : `Subprotocol "${bad}" has invalid characters`
}

/** Why the Socket.IO auth payload is invalid, or `null` (also for empty). */
export function socketAuthProblem(value: string): string | null {
  try {
    parseSocketAuth(value)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
