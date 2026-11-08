import { describe, expect, it } from 'vitest'
import {
  connackErrorMessage,
  connackReturnCodeText,
  describeError,
  formatReasonCode,
  isFatalConnackCode,
  isFatalTransportError,
  isV3ConnackCode,
  lowerFirst,
  reasonCodeText,
  serverRedirectMessage
} from '../../../src/main/services/mqtt/reason-codes'

const withCode = (code: string, message = code): Error =>
  Object.assign(new Error(message), { code })
const ctx = { host: 'broker.local', port: 1883 }

describe('reason codes', () => {
  it('describes MQTT 5 reason codes', () => {
    expect(reasonCodeText(0x87)).toBe('Not authorized')
    expect(reasonCodeText(0x86)).toBe('Bad user name or password')
    expect(reasonCodeText(0x9b)).toBe('QoS not supported')
    expect(reasonCodeText(0xa2)).toBe('Wildcard subscriptions not supported')
    expect(reasonCodeText(0xfe)).toBe('Reason code 0xfe')
    expect(formatReasonCode(0x8a)).toBe('0x8a')
    expect(formatReasonCode(4)).toBe('0x04')
  })

  it('describes MQTT 3 CONNACK return codes', () => {
    expect(connackReturnCodeText(4)).toBe('Bad user name or password')
    expect(connackReturnCodeText(9)).toBe('Return code 9')
  })

  it('classifies fatal CONNACK refusals (retrying the same CONNECT gets the same answer)', () => {
    const fatal = [
      0x81, 0x82, 0x84, 0x85, 0x86, 0x87, 0x8a, 0x8c, 0x95, 0x99, 0x9a, 0x9b, 0x9c, 0x9d
    ]
    for (const code of fatal) expect([code, isFatalConnackCode(code, 5)]).toEqual([code, true])
    // Transient: retried with backoff.
    for (const code of [0x80, 0x83, 0x88, 0x89, 0x97, 0x9f]) {
      expect([code, isFatalConnackCode(code, 5)]).toEqual([code, false])
    }
    for (const code of [1, 2, 4, 5]) expect(isFatalConnackCode(code, 4)).toBe(true)
    expect(isFatalConnackCode(3, 4)).toBe(false)
    expect(isFatalConnackCode(3, 3)).toBe(false)
  })

  it('formats CONNACK refusals', () => {
    expect(connackErrorMessage(5, 4)).toBe('Connection refused: not authorized')
    expect(connackErrorMessage(0x86, 5)).toBe('Connection refused: bad user name or password')
    expect(connackErrorMessage(0x82, 5)).toBe('Connection refused: protocol error')
    expect(connackErrorMessage(0x8a, 5, 'too many attempts')).toBe(
      'Connection refused: banned — too many attempts'
    )
  })

  it('points CONNACK refusals of the Last Will to the Last Will', () => {
    expect(connackErrorMessage(0x9a, 5)).toBe(
      "The broker does not support the Last Will's retain flag — change the Last Will"
    )
    expect(connackErrorMessage(0x9b, 5, 'max QoS 1')).toBe(
      "The broker does not support the Last Will's QoS — change the Last Will — max QoS 1"
    )
    expect(connackErrorMessage(0x99, 5)).toBe(
      'The Last Will message does not match its payload format — change the Last Will'
    )
  })

  it('names the server a redirecting broker points to', () => {
    expect(connackErrorMessage(0x9c, 5, undefined, 'eu.example.com:8883')).toBe(
      'The broker asks to use another server: eu.example.com:8883'
    )
    expect(connackErrorMessage(0x9d, 5, undefined, 'new.example.com')).toBe(
      'The broker moved to another server: new.example.com'
    )
    expect(connackErrorMessage(0x9c, 5)).toBe('The broker asks to use another server')
    expect(serverRedirectMessage(0x87, 'x')).toBeUndefined()
  })

  it('reads a 3.1.1 return code answered to an MQTT 5 CONNECT as one', () => {
    // A 3.1.1-only broker (aedes, old Mosquitto) answers return code 1, not "Granted QoS 1".
    expect(connackErrorMessage(1, 5)).toBe(
      'The broker does not support MQTT 5.0 — switch this connection to MQTT 3.1.1'
    )
    expect(isFatalConnackCode(1, 5)).toBe(true)
    expect(isV3ConnackCode(1, 5)).toBe(true)
    for (const code of [2, 4, 5]) expect(isFatalConnackCode(code, 5)).toBe(true)
    expect(connackErrorMessage(2, 5)).toBe('Connection refused: identifier rejected')
    expect(connackErrorMessage(4, 5)).toBe('Connection refused: bad user name or password')
    // Server unavailable stays retryable.
    expect(connackErrorMessage(3, 5)).toBe('Connection refused: server unavailable')
    expect(isFatalConnackCode(3, 5)).toBe(false)
  })

  it('keeps the MQTT 5 meaning of real MQTT 5 refusals (>= 0x80)', () => {
    expect(isV3ConnackCode(0x84, 5)).toBe(false)
    expect(connackErrorMessage(0x84, 5)).toBe('Connection refused: unsupported protocol version')
    expect(isFatalConnackCode(0x84, 5)).toBe(true)
    expect(isV3ConnackCode(0, 5)).toBe(false)
    // MQTT 3.x clients always get return codes.
    expect(isV3ConnackCode(1, 4)).toBe(true)
    expect(connackErrorMessage(1, 4)).toBe('Connection refused: unacceptable protocol version')
  })

  it('lower-cases only ordinary leading words', () => {
    expect(lowerFirst('Not authorized')).toBe('not authorized')
    expect(lowerFirst('QoS not supported')).toBe('QoS not supported')
    expect(lowerFirst('MQTT error')).toBe('MQTT error')
  })
})

describe('describeError', () => {
  it('explains socket errors', () => {
    expect(describeError(withCode('ECONNREFUSED'), ctx)).toBe(
      'Connection refused — is a broker listening on broker.local:1883?'
    )
    expect(describeError(withCode('ENOTFOUND'), ctx)).toBe('Host not found: broker.local')
    expect(describeError(withCode('EAI_AGAIN'), ctx)).toBe('Host not found: broker.local')
    expect(describeError(withCode('ETIMEDOUT'))).toBe('Connection timed out')
    expect(describeError(withCode('ECONNRESET'))).toBe('Connection reset by the broker')
  })

  it('looks into AggregateError (happy eyeballs)', () => {
    const err = new AggregateError([withCode('ECONNREFUSED'), withCode('ECONNREFUSED')], '')
    expect(describeError(err, ctx)).toContain('Connection refused')
  })

  it('explains TLS certificate errors with a hint', () => {
    for (const code of [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'DEPTH_ZERO_SELF_SIGNED_CERT'
    ]) {
      const message = describeError(withCode(code))
      expect(message).toContain('CA file')
      expect(message).toContain('disable certificate verification')
    }
    expect(describeError(withCode('CERT_HAS_EXPIRED'))).toContain('expired')
    expect(describeError(withCode('ERR_TLS_CERT_ALTNAME_INVALID'))).toContain('host name')
    expect(describeError(new Error('ssl3_get_record:wrong version number'))).toContain('TLS port')
    // BoringSSL (Electron) spells the reason in capitals.
    const boring = 'error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER'
    expect(describeError(new Error(boring))).toBe('TLS handshake failed — is this port a TLS port?')
  })

  it('treats certificate checks and a plain-text answer to TLS as fatal', () => {
    for (const code of [
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'CERT_HAS_EXPIRED',
      'CERT_NOT_YET_VALID',
      'ERR_SSL_WRONG_VERSION_NUMBER'
    ]) {
      expect([code, isFatalTransportError(withCode(code))]).toEqual([code, true])
    }
    expect(isFatalTransportError(new Error('TLS not authorized'))).toBe(true)
    expect(isFatalTransportError(new Error('ssl3_get_record:WRONG_VERSION_NUMBER'))).toBe(true)
    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']) {
      expect([code, isFatalTransportError(withCode(code))]).toEqual([code, false])
    }
    expect(isFatalTransportError(new Error('connack timeout'))).toBe(false)
  })

  it('explains a reset during the handshake by the transport (MQ-18)', () => {
    const tlsHint = (port: number): string =>
      `TLS handshake failed — the broker closed the connection. Is this port TLS-enabled (usually ${port})?`
    const wsHint = 'The broker closed the connection — is this a WebSocket port and path?'
    const tlsReset = withCode(
      'ECONNRESET',
      'Client network socket disconnected before secure TLS connection was established'
    )
    expect(describeError(withCode('ECONNRESET'), { protocol: 'mqtts' })).toBe(tlsHint(8883))
    expect(describeError(tlsReset, { ...ctx, protocol: 'mqtts' })).toBe(tlsHint(8883))
    expect(describeError(withCode('EPIPE'), { protocol: 'mqtts' })).toBe(tlsHint(8883))
    expect(describeError(tlsReset, { protocol: 'wss' })).toBe(tlsHint(8084))
    expect(describeError(new Error('socket hang up'), { protocol: 'ws' })).toBe(wsHint)
    expect(describeError(withCode('ECONNRESET', 'socket hang up'), { protocol: 'ws' })).toBe(wsHint)
    expect(describeError(withCode('ECONNRESET', 'socket hang up'), { protocol: 'wss' })).toBe(
      wsHint
    )
    // Plain TCP, a reset after the CONNACK and contexts without a protocol keep the old text.
    expect(describeError(withCode('ECONNRESET'), { ...ctx, protocol: 'mqtt' })).toBe(
      'Connection reset by the broker'
    )
    expect(describeError(withCode('ECONNRESET'), { protocol: 'mqtts', connected: true })).toBe(
      'Connection reset by the broker'
    )
    expect(describeError(withCode('ECONNRESET'), ctx)).toBe('Connection reset by the broker')
    expect(describeError(withCode('ECONNREFUSED'), { ...ctx, protocol: 'mqtts' })).toContain(
      'broker.local:1883'
    )
  })

  it('tidies mqtt.js messages', () => {
    expect(describeError(new Error('connack timeout'))).toBe('Connection timed out')
    expect(describeError(new Error('Connection refused: Not authorized'))).toBe(
      'Connection refused: not authorized'
    )
    expect(describeError(new Error('Publish error: Quota exceeded'))).toBe(
      'Publish refused: quota exceeded'
    )
    expect(describeError(new Error('Subscribe error: Not authorized'))).toBe(
      'Subscribe refused: not authorized'
    )
    expect(describeError(new Error('Keepalive timeout'))).toContain('Keep-alive timeout')
    expect(describeError(new Error('Unexpected server response: 404'))).toBe(
      'WebSocket handshake failed (HTTP 404) — check the WebSocket path'
    )
  })

  it('falls back to the capitalized message', () => {
    expect(describeError(new Error('client disconnecting'))).toBe('Client disconnecting')
    expect(describeError('plain string')).toBe('Plain string')
    expect(describeError(new Error(''))).toBe('Unknown error')
    expect(describeError({ message: 'shape only' })).toBe('Shape only')
  })
})
