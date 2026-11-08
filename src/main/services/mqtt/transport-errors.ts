/**
 * Human messages for socket / TLS / WebSocket errors (and the mqtt.js error texts), and which of
 * them retrying cannot fix. A reset during the handshake points to the likely mistake for the
 * transport (a TLS URL on a plain port, a WebSocket URL on a TCP port).
 */
import { DEFAULT_PORTS } from '@shared/defaults'
import type { MqttProtocol } from '@shared/models'
import { errorCode, errorMessage } from '../../utils/errors'

export interface ErrorContext {
  host?: string
  port?: number
  /** The transport of the connection (enables the handshake hints). */
  protocol?: MqttProtocol
  /** True once the broker answered CONNACK on the current network connection. */
  connected?: boolean
}

/** Lower-cases a leading ordinary word (`Not authorized` → `not authorized`, `QoS…` unchanged). */
export function lowerFirst(text: string): string {
  return /^[A-Z][a-z]*(\s|$)/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const TLS_TRUST_HINT = "Add the broker's CA file or disable certificate verification."
const NOT_TRUSTED = (): string => `Certificate not trusted. ${TLS_TRUST_HINT}`
const NAME_MISMATCH = (): string =>
  'The certificate does not match the host name. Set the SNI server name or disable certificate verification.'
const WRONG_TLS_PORT = (): string => 'TLS handshake failed — is this port a TLS port?'

/** OpenSSL says `wrong version number`, BoringSSL (Electron) `WRONG_VERSION_NUMBER`. */
const WRONG_VERSION = /wrong[ _]version[ _]number/i
/** Node's text for a TLS socket closed by the peer during the handshake. */
const TLS_RESET = /before secure TLS connection was established/i
const HANG_UP = /socket hang up/i

const CODE_MESSAGES: Readonly<Record<string, (ctx?: ErrorContext) => string>> = {
  ECONNREFUSED: (ctx) =>
    `Connection refused — is a broker listening on ${ctx?.host && ctx.port !== undefined ? `${ctx.host}:${ctx.port}` : 'this address'}?`,
  ENOTFOUND: (ctx) => (ctx?.host ? `Host not found: ${ctx.host}` : 'Host not found'),
  EAI_AGAIN: (ctx) => (ctx?.host ? `Host not found: ${ctx.host}` : 'Host not found'),
  ETIMEDOUT: () => 'Connection timed out',
  ECONNRESET: () => 'Connection reset by the broker',
  EPIPE: () => 'Connection closed by the broker',
  ECONNABORTED: () => 'Connection aborted',
  EHOSTUNREACH: (ctx) => (ctx?.host ? `Host unreachable: ${ctx.host}` : 'Host unreachable'),
  ENETUNREACH: () => 'Network unreachable — check your network connection',
  EADDRNOTAVAIL: () => 'Address not available',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: NOT_TRUSTED,
  UNABLE_TO_GET_ISSUER_CERT: NOT_TRUSTED,
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: NOT_TRUSTED,
  CERT_UNTRUSTED: NOT_TRUSTED,
  CERT_REJECTED: NOT_TRUSTED,
  CERT_SIGNATURE_FAILURE: NOT_TRUSTED,
  INVALID_CA: NOT_TRUSTED,
  SELF_SIGNED_CERT_IN_CHAIN: () => `Self-signed certificate in chain. ${TLS_TRUST_HINT}`,
  DEPTH_ZERO_SELF_SIGNED_CERT: () => `Self-signed certificate. ${TLS_TRUST_HINT}`,
  CERT_HAS_EXPIRED: () =>
    "The broker's certificate has expired. Renew it or disable certificate verification.",
  CERT_NOT_YET_VALID: () =>
    "The broker's certificate is not valid yet. Check the system clock or disable certificate verification.",
  CERT_REVOKED: () => "The broker's certificate has been revoked.",
  ERR_TLS_CERT_ALTNAME_INVALID: NAME_MISMATCH,
  HOSTNAME_MISMATCH: NAME_MISMATCH,
  ERR_SSL_WRONG_VERSION_NUMBER: WRONG_TLS_PORT,
  ERR_OSSL_BAD_DECRYPT: () => 'Cannot decrypt the private key — check the passphrase',
  ERR_OSSL_PEM_NO_START_LINE: () => 'Invalid certificate or key file (PEM expected)'
}

/**
 * Certificate verification failures and a TLS URL answered in plain text: the same attempt
 * fails the same way every time, so auto-reconnect must stop.
 */
const FATAL_TLS_CODES = new Set([
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REVOKED',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'CERT_SIGNATURE_FAILURE',
  'INVALID_CA',
  'ERR_SSL_WRONG_VERSION_NUMBER'
])

/** True for transport errors retrying cannot fix (TLS certificate checks, wrong TLS port). */
export function isFatalTransportError(err: unknown): boolean {
  const code = errorCode(err)
  if (code !== undefined && FATAL_TLS_CODES.has(code)) return true
  const message = errorMessage(err)
  return message === 'TLS not authorized' || WRONG_VERSION.test(message)
}

/**
 * The likely mistake behind a connection the broker closed before its CONNACK: a TLS URL on a
 * plain port, or a WebSocket URL on a port (or path) that does not speak WebSocket.
 */
function handshakeHint(
  code: string | undefined,
  message: string,
  ctx?: ErrorContext
): string | undefined {
  const protocol = ctx?.protocol
  if (!protocol || protocol === 'mqtt' || ctx.connected) return undefined
  const tlsReset = TLS_RESET.test(message)
  if (!tlsReset && code !== 'ECONNRESET' && code !== 'EPIPE' && !HANG_UP.test(message)) {
    return undefined
  }
  if (protocol === 'mqtts' || (protocol === 'wss' && tlsReset)) {
    const usual = DEFAULT_PORTS[protocol]
    return `TLS handshake failed — the broker closed the connection. Is this port TLS-enabled (usually ${usual})?`
  }
  return 'The broker closed the connection — is this a WebSocket port and path?'
}

/**
 * Turns mqtt.js / socket / TLS errors into a short human message, e.g.
 * `Connection refused — is a broker listening on localhost:1883?`.
 */
export function describeError(err: unknown, ctx?: ErrorContext): string {
  const code = errorCode(err)
  const message = errorMessage(err).trim()
  const hint = handshakeHint(code, message, ctx)
  if (hint) return hint
  const byCode = code ? CODE_MESSAGES[code] : undefined
  if (byCode) return byCode(ctx)

  if (/^connack timeout$/i.test(message)) return 'Connection timed out'
  if (/^keepalive timeout$/i.test(message))
    return 'Keep-alive timeout — the broker stopped responding'
  if (message === 'TLS not authorized')
    return `TLS certificate verification failed. ${TLS_TRUST_HINT}`
  if (WRONG_VERSION.test(message)) return WRONG_TLS_PORT()
  if (/bad decrypt/i.test(message)) return CODE_MESSAGES.ERR_OSSL_BAD_DECRYPT()

  const refused = /^(Connection refused|Publish error|Subscribe error):\s*(.+)$/i.exec(message)
  if (refused) {
    const action = refused[1].toLowerCase().startsWith('connection')
      ? 'Connection'
      : refused[1].split(' ')[0]
    return `${capitalize(action)} refused: ${lowerFirst(refused[2])}`
  }

  const ws = /Unexpected server response: (\d+)/i.exec(message)
  if (ws) return `WebSocket handshake failed (HTTP ${ws[1]}) — check the WebSocket path`

  return message ? capitalize(message) : 'Unknown error'
}
