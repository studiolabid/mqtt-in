/**
 * Maps a `ConnectionProfile` to the broker URL and mqtt.js client options. Pure: the TLS file
 * contents are read (and checked) beforehand by `loadTlsMaterial` and passed in.
 */
import { isIP } from 'node:net'
import type { IClientOptions } from 'mqtt'
import { brokerUrl, generateClientId, isTlsProtocol, LIMITS } from '@shared/defaults'
import type { ConnectionProfile, LastWill, TlsSettings } from '@shared/models'
import { assertMqttBinary, assertMqttString, assertUserProperties } from './mqtt-strings'
import { toConnectPacketProperties, toWillPacketProperties } from './properties'
import type { TlsMaterial } from './tls-material'

/** mqtt.js options plus the TLS `passphrase` it forwards to `tls.connect` (untyped upstream). */
export type ClientOptions = IClientOptions & { passphrase?: string }

export interface BuiltClientOptions {
  /** e.g. `mqtts://broker:8883` or `wss://broker:8084/mqtt`. */
  url: string
  options: ClientOptions
  /** Effective client id (generated when the profile's is empty). */
  clientId: string
}

/** Used when a profile carries a non-positive connect timeout (mqtt.js would time out instantly). */
const FALLBACK_CONNECT_TIMEOUT_MS = 30_000
/** Used when a profile carries no number as its reconnect period (the profile default). */
const FALLBACK_RECONNECT_PERIOD_MS = 4000

/**
 * The reconnect period mqtt.js gets (0 = no auto-reconnect): within LIMITS.reconnectPeriodMs,
 * so an imported or hand-edited profile (e.g. 1 ms) cannot flood the broker with attempts. The
 * session doubles it after every failed attempt (`ReconnectBackoff`).
 */
export function reconnectPeriodOf(profile: ConnectionProfile): number {
  if (!profile.autoReconnect) return 0
  const period = profile.reconnectPeriod
  if (!Number.isFinite(period)) return FALLBACK_RECONNECT_PERIOD_MS
  const { min, max } = LIMITS.reconnectPeriodMs
  return Math.min(max, Math.max(min, Math.round(period)))
}

/**
 * Builds the mqtt.js connection options for a profile; `tls` holds the TLS file contents
 * (`loadTlsMaterial`). Throws a human error when the host is empty or a CONNECT field cannot be
 * encoded (MQTT strings over 65,535 bytes): mqtt-packet would throw half way through the
 * CONNECT and every attempt would time out.
 */
export function buildClientOptions(
  profile: ConnectionProfile,
  tls: TlsMaterial = {}
): BuiltClientOptions {
  const host = profile.host.trim()
  if (!host) throw new Error('Host is required')
  const clientId = profile.clientId.trim() === '' ? generateClientId() : profile.clientId
  const v5 = profile.protocolVersion === 5
  assertConnectFields(profile, clientId)

  const options: ClientOptions = {
    clientId,
    protocolVersion: profile.protocolVersion,
    protocolId: profile.protocolVersion === 3 ? 'MQIsdp' : 'MQTT',
    clean: profile.clean,
    keepalive: profile.keepalive,
    connectTimeout:
      profile.connectTimeout > 0 ? profile.connectTimeout : FALLBACK_CONNECT_TIMEOUT_MS,
    reconnectPeriod: reconnectPeriodOf(profile),
    // Keep retrying transient CONNACK refusals (server busy…); fatal ones are stopped by the session.
    reconnectOnConnackError: profile.autoReconnect,
    // Sessions restore their subscriptions themselves (with per-subscription state).
    resubscribe: false,
    // Fail fast instead of silently queueing QoS 0 messages while offline.
    queueQoSZero: false
  }

  if (profile.username !== '') options.username = profile.username
  if (profile.password !== '') {
    options.password = profile.password
    // mqtt-packet refuses a password without a user name; an empty one is protocol-valid.
    options.username ??= ''
  }

  if (isTlsProtocol(profile.protocol)) applyTls(options, profile, host, tls)

  const will = buildWill(profile.will, v5)
  if (will) options.will = will

  if (v5) {
    const properties = toConnectPacketProperties(profile.properties)
    if (properties) options.properties = properties
  }

  return { url: brokerUrl({ ...profile, host }), options, clientId }
}

/** The CONNECT strings mqtt-packet writes with a 2-byte length (MQTT 5 parts on 5.0 only). */
function assertConnectFields(profile: ConnectionProfile, clientId: string): void {
  assertMqttString(clientId, 'Client ID')
  assertMqttString(profile.username, 'User name')
  assertMqttBinary(profile.password, 'Password')
  const v5 = profile.protocolVersion === 5
  if (v5) assertUserProperties(profile.properties.userProperties)
  const will = profile.will
  if (!will.enabled || will.topic === '') return
  assertMqttString(will.topic, 'Will topic')
  assertMqttBinary(will.payload, 'Will message')
  if (!v5) return
  assertMqttString(will.properties.contentType, 'Will content type')
  assertMqttString(will.properties.responseTopic, 'Will response topic')
  assertMqttBinary(will.properties.correlationData, 'Will correlation data')
  assertUserProperties(will.properties.userProperties, 'Will user property')
}

function applyTls(
  options: ClientOptions,
  profile: ConnectionProfile,
  host: string,
  material: TlsMaterial
): void {
  const tls: TlsSettings = profile.tls
  options.rejectUnauthorized = tls.rejectUnauthorized
  if (material.ca) options.ca = material.ca
  if (material.cert) options.cert = material.cert
  if (material.key) options.key = material.key
  if (tls.passphrase !== '') options.passphrase = tls.passphrase

  const customServername = tls.servername.trim()
  const servername = customServername || (isIP(host) === 0 ? host : undefined)
  if (servername) options.servername = servername

  const alpn = tls.alpnProtocols.map((p) => p.trim()).filter((p) => p.length > 0)
  if (alpn.length > 0) options.ALPNProtocols = alpn

  // For wss, mqtt.js forwards ca/cert/key/passphrase/rejectUnauthorized to `ws` itself,
  // but SNI overrides and ALPN must be passed through `wsOptions`.
  if (profile.protocol === 'wss' && (customServername || alpn.length > 0)) {
    const wsOptions: {
      rejectUnauthorized: boolean
      servername?: string
      ALPNProtocols?: string[]
    } = { rejectUnauthorized: tls.rejectUnauthorized }
    if (customServername) wsOptions.servername = customServername
    if (alpn.length > 0) wsOptions.ALPNProtocols = alpn
    options.wsOptions = wsOptions
  }
}

function buildWill(will: LastWill, v5: boolean): IClientOptions['will'] {
  if (!will.enabled || will.topic === '') return undefined
  const packetWill: NonNullable<IClientOptions['will']> = {
    topic: will.topic,
    payload: Buffer.from(will.payload, 'utf8'),
    qos: will.qos,
    retain: will.retain
  }
  if (v5) {
    const properties = toWillPacketProperties(will.properties)
    if (properties) packetWill.properties = properties
  }
  return packetWill
}
