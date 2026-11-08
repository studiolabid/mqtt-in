/**
 * Opening the mqtt.js client of a session: the TLS files (read and checked asynchronously, only
 * for TLS profiles that name files) and the client itself, with the session's listeners attached
 * before the first CONNECT packet is written.
 */
import { connect as mqttConnect, type MqttClient } from 'mqtt'
import { isTlsProtocol } from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import { type ClientHandlers, listenTo } from './client-lifecycle'
import type { BuiltClientOptions } from './client-options'
import { hasTlsFiles, loadTlsMaterial } from './tls-material'
import type { ConnectFn, ReadFileFn } from './types'

/** True when connecting must first read TLS files (a TLS protocol and at least one path). */
export function needsTlsFiles(profile: ConnectionProfile): boolean {
  return isTlsProtocol(profile.protocol) && hasTlsFiles(profile.tls)
}

/**
 * `built` with the contents of the profile's TLS files (read with a timeout and checked with
 * `tls.createSecureContext`). Rejects with a human error, e.g. `Cannot decrypt the private key —
 * check the passphrase`.
 */
export async function withTlsMaterial(
  profile: ConnectionProfile,
  built: BuiltClientOptions,
  readFile?: ReadFileFn
): Promise<BuiltClientOptions> {
  const material = await loadTlsMaterial(profile.tls, { readFile })
  return { ...built, options: { ...built.options, ...material } }
}

export interface CreatedClient {
  client: MqttClient
  /** Removes exactly the handlers attached here. */
  detach: () => void
}

/**
 * Creates the mqtt.js client with `manualConnect` and attaches `handlers`; the caller then calls
 * `client.connect()`, so the handlers see the very first CONNECT.
 */
export function createClient(
  built: BuiltClientOptions,
  handlers: ClientHandlers,
  connect: ConnectFn = mqttConnect
): CreatedClient {
  const client = connect(built.url, { ...built.options, manualConnect: true })
  return { client, detach: listenTo(client, handlers) }
}
