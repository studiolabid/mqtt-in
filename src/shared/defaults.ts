/**
 * Defaults, factories and small pure helpers for the domain models, plus the app-wide constants
 * of `./constants` (re-exported: import everything from `@shared/defaults`).
 * Safe to import from main, preload and renderer.
 */
import { DEFAULT_SOCKET_SETTINGS } from './connection-kind'
import { DEFAULT_PORTS, NEUTRAL_COLOR, PALETTE } from './constants'
import type { ConnectionProfile, MqttProtocol, Subscription } from './models'

export * from './constants'

/** Random RFC 4122 v4 UUID. */
export function newId(): string {
  return globalThis.crypto.randomUUID()
}

/** Prefix of generated client ids (no hyphen: some brokers only accept letters, digits and `_`). */
const CLIENT_ID_PREFIX = 'mqttin'

/** `mqttin_` + 8 random hex chars (fits the 23-character limit of MQTT 3.1). */
export function generateClientId(prefix = CLIENT_ID_PREFIX): string {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${prefix}_${suffix}`
}

/** Also matches ids generated before the app was renamed from mqtey (stored by older profiles). */
const GENERATED_CLIENT_ID = /^(?:mqttin|mqtey)_[0-9a-f]{8}$/

/** True for a client id made by `generateClientId()` (`mqttin_` + 8 lower-case hex chars). */
export function isGeneratedClientId(clientId: string): boolean {
  return GENERATED_CLIENT_ID.test(clientId)
}

/** Palette color for an index; wraps around (negative too). Non-finite indexes map to 0. */
export function pickColor(index: number): string {
  const i = Number.isFinite(index) ? Math.floor(index) : 0
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]
}

export function isTlsProtocol(protocol: MqttProtocol): boolean {
  return protocol === 'mqtts' || protocol === 'wss'
}

export function isWebSocketProtocol(protocol: MqttProtocol): boolean {
  return protocol === 'ws' || protocol === 'wss'
}

/** e.g. `mqtt://broker.local:1883` or `wss://broker.local:8084/mqtt`. */
export function brokerUrl(
  profile: Pick<ConnectionProfile, 'protocol' | 'host' | 'port' | 'path'>
): string {
  const { host: rawHost, path: rawPath } = profile
  const host = rawHost.includes(':') && !rawHost.startsWith('[') ? `[${rawHost}]` : rawHost
  const base = `${profile.protocol}://${host}:${profile.port}`
  if (!isWebSocketProtocol(profile.protocol)) return base
  const path = rawPath ? (rawPath.startsWith('/') ? rawPath : `/${rawPath}`) : ''
  return base + path
}

/**
 * A new subscription (`#`, QoS 0, the neutral color, enabled, Retain As Published on);
 * `overrides` are applied shallowly. Retain As Published is on so live retained publishes keep
 * their RETAIN flag (brokers clear it for existing subscribers otherwise); it is ignored on
 * MQTT 3.1 / 3.1.1, and an explicit `false` is kept.
 */
export function createSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: newId(),
    topic: '#',
    qos: 0,
    color: NEUTRAL_COLOR,
    alias: '',
    enabled: true,
    noLocal: false,
    retainAsPublished: true,
    retainHandling: 0,
    subscriptionIdentifier: undefined,
    createdAt: Date.now(),
    ...overrides
  }
}

/**
 * A new profile for a local broker (mqtt://localhost:1883, MQTT 5); `overrides` are applied
 * shallowly (nested objects replace the defaults, the port does not follow the protocol).
 */
export function createConnectionProfile(
  overrides: Partial<ConnectionProfile> = {}
): ConnectionProfile {
  const now = Date.now()
  return {
    id: newId(),
    name: 'New connection',
    color: NEUTRAL_COLOR,
    group: '',
    protocol: 'mqtt',
    host: 'localhost',
    port: DEFAULT_PORTS.mqtt,
    path: '/mqtt',
    clientId: generateClientId(),
    username: '',
    password: '',
    protocolVersion: 5,
    clean: true,
    keepalive: 60,
    connectTimeout: 10_000,
    autoReconnect: true,
    reconnectPeriod: 4_000,
    tls: {
      rejectUnauthorized: true,
      caPath: '',
      certPath: '',
      keyPath: '',
      passphrase: '',
      servername: '',
      alpnProtocols: []
    },
    will: {
      enabled: false,
      topic: '',
      payload: '',
      qos: 0,
      retain: false,
      properties: { userProperties: [] }
    },
    properties: { userProperties: [] },
    subscriptions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Own fields that hold a value: `undefined` / `null` (legacy JSON) count as missing. */
function presentFields<T extends object>(value: T | null | undefined): Partial<T> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined && field !== null)
  ) as Partial<T>
}

function arrayOr<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : []
}

/** Deep copy of JSON-like data (plain objects, arrays); reads through proxies (Vue reactive). */
function copyData<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item: unknown) => copyData(item)) as T
  if (!isRecord(value) || ArrayBuffer.isView(value)) return value
  const copy: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) copy[key] = copyData(item)
  return copy as T
}

/**
 * Deep-merges a possibly partial / older-version profile over fresh defaults.
 * Used when loading from disk or importing files so missing fields never crash the UI:
 * never throws, treats `null` / `undefined` fields as missing, replaces malformed
 * collections with empty ones and drops subscription entries that are not objects.
 * Field *types* are not validated (that is the job of the IPC / import schema).
 *
 * A profile without clean start (`clean: false`) and with an empty client id gets a generated
 * one, kept from then on: a persistent session can only be resumed under the same id (a new id
 * per connect would leave an orphan session on the broker every time).
 */
export function normalizeConnectionProfile(input: Partial<ConnectionProfile>): ConnectionProfile {
  const fields = presentFields(input)
  const tls = presentFields(fields.tls)
  const will = presentFields(fields.will)
  const willProperties = presentFields(will.properties)
  const properties = presentFields(fields.properties)
  const base = createConnectionProfile({ id: fields.id ?? newId() })
  const persistent = fields.clean === false
  const clientId = fields.clientId ?? base.clientId
  const socket = isRecord(fields.socket) ? presentFields(fields.socket) : undefined
  return {
    ...base,
    ...fields,
    tls: { ...base.tls, ...tls, alpnProtocols: arrayOr(tls.alpnProtocols) },
    will: {
      ...base.will,
      ...will,
      properties: {
        ...base.will.properties,
        ...willProperties,
        userProperties: arrayOr(willProperties.userProperties)
      }
    },
    properties: {
      ...base.properties,
      ...properties,
      userProperties: arrayOr(properties.userProperties)
    },
    // A malformed `socket` (not an object) is dropped: the defaults apply.
    socket: socket && {
      ...DEFAULT_SOCKET_SETTINGS,
      ...socket,
      headers: arrayOr(socket.headers)
    },
    subscriptions: arrayOr<unknown>(fields.subscriptions)
      .filter((s): s is Partial<Subscription> => isRecord(s))
      .map((s) => createSubscription(presentFields(s))),
    clientId:
      persistent && typeof clientId === 'string' && clientId.trim() === ''
        ? generateClientId()
        : clientId
  }
}

/**
 * A copy of `profile` that can live next to the original (import, duplicate): new profile and
 * subscription ids, `name`, `createdAt` / `updatedAt` = `now`, no `lastConnectedAt`, and a new
 * client id when the old one was generated by mqtt-in (two connections with one client id keep
 * taking the session over from each other). Custom client ids are kept: broker policies may
 * require them. The input is not changed; it may be a Vue reactive proxy.
 */
export function withFreshIdentity(
  profile: ConnectionProfile,
  options: { name: string; now: number }
): ConnectionProfile {
  const copy = copyData(profile)
  copy.id = newId()
  copy.name = options.name
  copy.createdAt = options.now
  copy.updatedAt = options.now
  delete copy.lastConnectedAt
  copy.subscriptions = copy.subscriptions.map((sub) => ({ ...sub, id: newId() }))
  if (isGeneratedClientId(copy.clientId)) copy.clientId = generateClientId()
  return copy
}
