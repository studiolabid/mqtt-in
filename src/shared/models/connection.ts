/**
 * Connection profiles (persisted), the primitives they are built from, and the import / export
 * contract of `connections.*`.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type QoS = 0 | 1 | 2

/** 3 = MQTT 3.1, 4 = MQTT 3.1.1, 5 = MQTT 5.0 */
export type MqttProtocolVersion = 3 | 4 | 5

/** Transport. TLS is used iff the protocol is `mqtts` or `wss`. */
export type MqttProtocol = 'mqtt' | 'mqtts' | 'ws' | 'wss'

/**
 * What a connection talks to: an MQTT broker, a plain WebSocket server or a Socket.IO server.
 * WebSocket and Socket.IO connections use the `ws` / `wss` protocols and the `socket` settings;
 * the MQTT-only fields (version, client id, session, Last Will, subscriptions…) are ignored.
 */
export type ConnectionKind = 'mqtt' | 'websocket' | 'socketio'

/** Options of WebSocket and Socket.IO connections (`ConnectionProfile.socket`). */
export interface SocketSettings {
  /** Extra HTTP headers of the opening handshake (e.g. `Authorization`). */
  headers: UserProperty[]
  /** WebSocket subprotocols (`Sec-WebSocket-Protocol`), comma separated. Empty = none. */
  subprotocols: string
  /** Socket.IO namespace, e.g. `/` or `/admin`. */
  namespace: string
  /** Socket.IO `auth` payload: a JSON object. Empty = none. */
  auth: string
  /**
   * WebSocket: the JSON field whose value names an incoming message's topic (e.g. `type`).
   * Empty, or a message without it: the topic is `message`.
   */
  topicField: string
}

/** MQTT 5 retain handling subscription option. */
export type RetainHandling = 0 | 1 | 2

/** An MQTT 5 user property. A list (not a record) so duplicate keys are allowed. */
export interface UserProperty {
  key: string
  value: string
}

// ---------------------------------------------------------------------------
// Connection profile (persisted)
// ---------------------------------------------------------------------------

export interface TlsSettings {
  /** Verify the broker certificate chain. Disable for self-signed brokers. */
  rejectUnauthorized: boolean
  /** Absolute path to a CA bundle (PEM/CRT). Empty = system CAs. */
  caPath: string
  /** Absolute path to the client certificate (mutual TLS). */
  certPath: string
  /** Absolute path to the client private key (mutual TLS). */
  keyPath: string
  /** Passphrase for an encrypted private key. Encrypted at rest when possible. */
  passphrase: string
  /** SNI server name override. Empty = host. */
  servername: string
  /** ALPN protocols, e.g. `['x-amzn-mqtt-ca']` for AWS IoT over 443. */
  alpnProtocols: string[]
}

/** MQTT 5 CONNECT properties. Undefined numeric fields are not sent. */
export interface ConnectProperties {
  sessionExpiryInterval?: number
  receiveMaximum?: number
  maximumPacketSize?: number
  topicAliasMaximum?: number
  requestResponseInformation?: boolean
  requestProblemInformation?: boolean
  userProperties: UserProperty[]
}

/** MQTT 5 Will properties. */
export interface WillProperties {
  willDelayInterval?: number
  payloadFormatIndicator?: boolean
  messageExpiryInterval?: number
  contentType?: string
  responseTopic?: string
  correlationData?: string
  userProperties: UserProperty[]
}

export interface LastWill {
  enabled: boolean
  topic: string
  payload: string
  qos: QoS
  retain: boolean
  properties: WillProperties
}

export interface Subscription {
  id: string
  /** Topic filter, may contain `+` / `#` and `$share/<group>/` prefixes. */
  topic: string
  qos: QoS
  /** Hex color (e.g. `#22c55e`) used to tag messages matching this subscription. */
  color: string
  /** Optional friendly label shown instead of the filter. */
  alias: string
  /** Disabled subscriptions are kept in the profile but not subscribed. */
  enabled: boolean
  /** MQTT 5 options (ignored for 3.1/3.1.1). */
  noLocal: boolean
  /**
   * Deliveries keep the RETAIN flag they were published with. On by default
   * (`createSubscription`): without it the broker clears the flag on live retained publishes.
   */
  retainAsPublished: boolean
  retainHandling: RetainHandling
  subscriptionIdentifier?: number
  createdAt: number
}

export interface ConnectionProfile {
  id: string
  /** Missing = `mqtt` (every profile saved before WebSocket and Socket.IO support). */
  kind?: ConnectionKind
  name: string
  /** Hex color for the avatar. */
  color: string
  /** Optional folder name. Empty string = ungrouped. */
  group: string
  protocol: MqttProtocol
  host: string
  port: number
  /** WebSocket path (ws/wss only), e.g. `/mqtt`. */
  path: string
  /**
   * Empty = a new `mqttin_xxxxxxxx` id on every connect. With `clean: false` the id is generated
   * once and stored instead (`normalizeConnectionProfile`): a persistent session needs a fixed id.
   */
  clientId: string
  username: string
  /** Plain text in memory; encrypted at rest by the main process when supported. */
  password: string
  protocolVersion: MqttProtocolVersion
  /** Clean session (3.x) / clean start (5.0). */
  clean: boolean
  /** Seconds. */
  keepalive: number
  /** Milliseconds. */
  connectTimeout: number
  autoReconnect: boolean
  /**
   * Connect when mqtt-in starts (once per app run; a renderer reload never reconnects a closed
   * connection). Missing = off.
   */
  autoConnect?: boolean
  /** Milliseconds between reconnect attempts. */
  reconnectPeriod: number
  tls: TlsSettings
  will: LastWill
  properties: ConnectProperties
  /** WebSocket and Socket.IO options (missing = the defaults, `DEFAULT_SOCKET_SETTINGS`). */
  socket?: SocketSettings
  subscriptions: Subscription[]
  createdAt: number
  updatedAt: number
  lastConnectedAt?: number
}

// ---------------------------------------------------------------------------
// Import / export files (`connections.exportToFile` / `importFromFile`)
// ---------------------------------------------------------------------------

export interface ExportConnectionsOptions {
  /** Write passwords and TLS passphrases in plain text. Default false. */
  includeSecrets?: boolean
}

/** A file entry that was not imported. */
export interface ImportSkippedEntry {
  /** The entry's connection name, when it has one. */
  name?: string
  /** Short human reason, e.g. `port: Too big: expected number to be <=65535`. */
  reason: string
}

/** The outcome of `connections.importFromFile()`. */
export interface ImportConnectionsResult {
  /** The saved profiles (fresh ids), in file order. */
  imported: ConnectionProfile[]
  /**
   * Entries not imported (invalid shape or values, no host, refused like a save would be); at
   * most 20 listed, the rest only logged. A file over the 1,000-entry limit is refused as a whole
   * instead (the call rejects), so its entries are never listed here.
   */
  skipped: ImportSkippedEntry[]
  /**
   * Entries that are the same connection as a saved one or an earlier entry of the file:
   * protocol, host (any case), port, the WebSocket path (ws/wss only), user name and client id;
   * with an empty client id (a new id on every connect) the name instead.
   */
  duplicates: number
  /**
   * Imported profiles with at least one TLS file path cleared (only absolute local-drive or POSIX
   * paths are kept); a cleared key path also clears the key passphrase.
   */
  tlsPathsCleared: number
  /** Recognized file format. */
  source: 'mqtt-in' | 'mqttx' | 'profile'
}
