/**
 * Human readable MQTT reason codes and CONNACK refusals, and which refusals retrying cannot fix.
 * Socket / TLS / WebSocket errors are described by `./transport-errors` (re-exported here).
 */
import type { MqttProtocolVersion } from '@shared/models'
import { lowerFirst } from './transport-errors'

export {
  describeError,
  type ErrorContext,
  isFatalTransportError,
  lowerFirst
} from './transport-errors'

/** MQTT 5 reason codes (spec §2.4) in sentence case. 0x00 depends on the packet. */
const REASON_CODES: Readonly<Record<number, string>> = {
  0x00: 'Success',
  0x01: 'Granted QoS 1',
  0x02: 'Granted QoS 2',
  0x04: 'Disconnect with Will Message',
  0x10: 'No matching subscribers',
  0x11: 'No subscription existed',
  0x18: 'Continue authentication',
  0x19: 'Re-authenticate',
  0x80: 'Unspecified error',
  0x81: 'Malformed packet',
  0x82: 'Protocol error',
  0x83: 'Implementation specific error',
  0x84: 'Unsupported protocol version',
  0x85: 'Client identifier not valid',
  0x86: 'Bad user name or password',
  0x87: 'Not authorized',
  0x88: 'Server unavailable',
  0x89: 'Server busy',
  0x8a: 'Banned',
  0x8b: 'Server shutting down',
  0x8c: 'Bad authentication method',
  0x8d: 'Keep alive timeout',
  0x8e: 'Session taken over',
  0x8f: 'Topic filter invalid',
  0x90: 'Topic name invalid',
  0x91: 'Packet identifier in use',
  0x92: 'Packet identifier not found',
  0x93: 'Receive maximum exceeded',
  0x94: 'Topic alias invalid',
  0x95: 'Packet too large',
  0x96: 'Message rate too high',
  0x97: 'Quota exceeded',
  0x98: 'Administrative action',
  0x99: 'Payload format invalid',
  0x9a: 'Retain not supported',
  0x9b: 'QoS not supported',
  0x9c: 'Use another server',
  0x9d: 'Server moved',
  0x9e: 'Shared subscriptions not supported',
  0x9f: 'Connection rate exceeded',
  0xa0: 'Maximum connect time',
  0xa1: 'Subscription identifiers not supported',
  0xa2: 'Wildcard subscriptions not supported'
}

/** MQTT 3.1 / 3.1.1 CONNACK return codes. */
const CONNACK_RETURN_CODES: Readonly<Record<number, string>> = {
  1: 'Unacceptable protocol version',
  2: 'Identifier rejected',
  3: 'Server unavailable',
  4: 'Bad user name or password',
  5: 'Not authorized'
}

/**
 * MQTT 5 CONNACK refusals that retrying cannot fix: the same CONNECT gets the same answer
 * (malformed, protocol error, unsupported version, client id, credentials, not authorized,
 * banned, authentication method, too large, a Last Will the broker refuses, another server).
 * Busy / unavailable / rate limits (0x88, 0x89, 0x9f…) stay retryable, with backoff.
 */
const FATAL_V5_CONNACK = new Set([
  0x81, 0x82, 0x84, 0x85, 0x86, 0x87, 0x8a, 0x8c, 0x95, 0x99, 0x9a, 0x9b, 0x9c, 0x9d
])
const FATAL_V3_CONNACK = new Set([1, 2, 4, 5])

/** What a 3.1.1-only broker answers to an MQTT 5 CONNECT (return code 1). */
const MQTT5_UNSUPPORTED =
  'The broker does not support MQTT 5.0 — switch this connection to MQTT 3.1.1'

/** CONNACK refusals of the Last Will (the only part of a CONNECT these codes can be about). */
const WILL_REFUSALS: Readonly<Record<number, string>> = {
  0x99: 'The Last Will message does not match its payload format — change the Last Will',
  0x9a: "The broker does not support the Last Will's retain flag — change the Last Will",
  0x9b: "The broker does not support the Last Will's QoS — change the Last Will"
}

/** `0x87` */
export function formatReasonCode(code: number): string {
  return `0x${code.toString(16).padStart(2, '0')}`
}

/** Text of an MQTT 5 reason code, e.g. `Not authorized`. */
export function reasonCodeText(code: number): string {
  return REASON_CODES[code] ?? `Reason code ${formatReasonCode(code)}`
}

/** Text of an MQTT 3.x CONNACK return code, e.g. `Bad user name or password`. */
export function connackReturnCodeText(code: number): string {
  return CONNACK_RETURN_CODES[code] ?? `Return code ${code}`
}

/**
 * True when an MQTT 5 client got a CONNACK code below 0x80: every MQTT 5 refusal is >= 0x80, so
 * this is a 3.1.1 return code from a broker that does not speak MQTT 5 (aedes, old Mosquitto…).
 */
export function isV3ConnackCode(code: number, protocolVersion: MqttProtocolVersion): boolean {
  return protocolVersion !== 5 || (code > 0 && code < 0x80)
}

/** True when a refused CONNACK should stop auto-reconnect. */
export function isFatalConnackCode(code: number, protocolVersion: MqttProtocolVersion): boolean {
  return isV3ConnackCode(code, protocolVersion)
    ? FATAL_V3_CONNACK.has(code)
    : FATAL_V5_CONNACK.has(code)
}

/**
 * `The broker asks to use another server: <reference>` for a CONNACK or DISCONNECT 0x9c / 0x9d
 * (MQTT 5 Server Reference, usually `host[:port]`); undefined for any other code.
 */
export function serverRedirectMessage(code: 0x9c | 0x9d, serverReference?: string): string
export function serverRedirectMessage(code: number, serverReference?: string): string | undefined
export function serverRedirectMessage(code: number, serverReference?: string): string | undefined {
  if (code !== 0x9c && code !== 0x9d) return undefined
  const text =
    code === 0x9c ? 'The broker asks to use another server' : 'The broker moved to another server'
  return serverReference ? `${text}: ${serverReference}` : text
}

/**
 * `Connection refused: not authorized` (+ ` — <reason string>` sent by an MQTT 5 broker). An MQTT 5
 * client refused with a 3.1.1 return code reads it as one; return code 1 means the broker does
 * not speak MQTT 5.0 at all. Refusals of the Last Will say so, and a redirect (0x9c / 0x9d) names
 * the server the broker points to.
 */
export function connackErrorMessage(
  code: number,
  protocolVersion: MqttProtocolVersion,
  reasonString?: string,
  serverReference?: string
): string {
  const v3 = isV3ConnackCode(code, protocolVersion)
  if (v3 && protocolVersion === 5 && code === 1) return MQTT5_UNSUPPORTED
  const special = v3
    ? undefined
    : (WILL_REFUSALS[code] ?? serverRedirectMessage(code, serverReference))
  const text = v3 ? connackReturnCodeText(code) : reasonCodeText(code)
  const message = special ?? `Connection refused: ${lowerFirst(text)}`
  return reasonString ? `${message} — ${reasonString}` : message
}
