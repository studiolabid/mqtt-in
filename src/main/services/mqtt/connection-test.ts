/**
 * "Test connection": one CONNECT with the settings in the connection dialog (saved or not), then a
 * clean DISCONNECT. No reconnects, no subscriptions; a clean disconnect means the broker never
 * publishes the Last Will.
 *
 * The test never disturbs a real session. A fixed client id is only reused when the connection
 * is not live and starts clean; otherwise a generated id is used, because a broker drops the older
 * of two clients with one id, and a persistent session would hand its queued messages to the test.
 */
import { connect as mqttConnect, type IClientOptions, type MqttClient } from 'mqtt'
import { generateClientId } from '@shared/defaults'
import type { ConnectionProfile, ConnectionTestResult } from '@shared/models'
import { errorMessage } from '../../utils/errors'
import { buildClientOptions, type BuiltClientOptions } from './client-options'
import { connackErrorMessage } from './reason-codes'
import { needsTlsFiles, withTlsMaterial } from './session-client'
import { describeError } from './transport-errors'
import type { ConnectFn, ReadFileFn } from './types'

/** Upper bound of one test, whatever the profile's connect timeout says. */
export const CONNECTION_TEST_TIMEOUT_MS = 15_000

export interface ConnectionTestOptions {
  /** True while the connection has a live session (connected, connecting or reconnecting). */
  live?: boolean
  connect?: ConnectFn
  readFile?: ReadFileFn
  /** Defaults to `Date.now`. */
  now?: () => number
}

/** The client id the test connects with (see the module comment). */
export function testClientId(profile: ConnectionProfile, live: boolean): string {
  const custom = profile.clientId.trim()
  return custom !== '' && profile.clean && !live ? profile.clientId : generateClientId()
}

/** Connects once with `profile` and reports the outcome; never rejects. */
export async function testConnection(
  profile: ConnectionProfile,
  options: ConnectionTestOptions = {}
): Promise<ConnectionTestResult> {
  const now = options.now ?? Date.now
  const started = now()
  const clientId = testClientId(profile, options.live ?? false)
  const failure = (message: string): ConnectionTestResult => ({
    ok: false,
    message,
    clientId,
    durationMs: now() - started
  })

  let built: BuiltClientOptions
  try {
    built = buildClientOptions({ ...profile, clientId })
    if (needsTlsFiles(profile)) built = await withTlsMaterial(profile, built, options.readFile)
  } catch (err) {
    return failure(errorMessage(err))
  }

  const timeoutMs = Math.min(
    profile.connectTimeout > 0 ? profile.connectTimeout : CONNECTION_TEST_TIMEOUT_MS,
    CONNECTION_TEST_TIMEOUT_MS
  )
  const clientOptions: IClientOptions = {
    ...built.options,
    clientId,
    reconnectPeriod: 0,
    reconnectOnConnackError: false,
    connectTimeout: timeoutMs
  }
  const context = { host: profile.host.trim(), port: profile.port, protocol: profile.protocol }
  const connect = options.connect ?? mqttConnect

  return new Promise<ConnectionTestResult>((resolve) => {
    let client: MqttClient | null = null
    let settled = false
    const finish = (result: ConnectionTestResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client?.removeAllListeners()
      // Keep an error listener: a late socket error must not become an uncaught exception.
      client?.on('error', () => undefined)
      client?.end(!result.ok)
      resolve(result)
    }
    const timer = setTimeout(() => finish(failure('Connection timed out')), timeoutMs + 1000)

    try {
      client = connect(built.url, clientOptions)
    } catch (err) {
      finish(failure(describeError(err, context)))
      return
    }
    client.on('connect', (connack) => {
      const reasonCode = connack.reasonCode ?? connack.returnCode ?? 0
      if (reasonCode >= 0x80 || (profile.protocolVersion !== 5 && reasonCode !== 0)) {
        finish(failure(connackErrorMessage(reasonCode, profile.protocolVersion)))
        return
      }
      finish({ ok: true, message: 'Connected', clientId, durationMs: now() - started })
    })
    client.on('error', (err) => {
      const code = (err as { code?: unknown }).code
      if (typeof code === 'number' && code > 0) {
        finish(failure(connackErrorMessage(code, profile.protocolVersion)))
        return
      }
      finish(failure(describeError(err, context)))
    })
    client.on('close', () => finish(failure('The broker closed the connection')))
  })
}
