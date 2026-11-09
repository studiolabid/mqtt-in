/**
 * "Test connection" for WebSocket and Socket.IO profiles: one attempt with the dialog's
 * settings (saved or not), closed as soon as it is open. No retries, nothing is sent.
 */
import { connectionKind } from '@shared/connection-kind'
import type { ConnectionProfile, ConnectionTestResult } from '@shared/models'
import { errorMessage } from '../../utils/errors'
import { CONNECTION_TEST_TIMEOUT_MS } from '../mqtt/connection-test'
import { hasTlsFiles, loadTlsMaterial, type TlsMaterial } from '../mqtt/tls-material'
import type { ReadFileFn } from '../mqtt/types'
import { openSocketIo } from './socketio-transport'
import type { OpenTransport } from './types'
import { openWebSocket } from './websocket-transport'

export interface SocketTestOptions {
  open?: OpenTransport
  readFile?: ReadFileFn
  now?: () => number
  timeoutMs?: number
}

/** Opens one connection with `profile` and reports the outcome; never rejects. */
export async function testSocketConnection(
  profile: ConnectionProfile,
  options: SocketTestOptions = {}
): Promise<ConnectionTestResult> {
  const now = options.now ?? Date.now
  const started = now()
  const result = (ok: boolean, message: string, clientId = ''): ConnectionTestResult => ({
    ok,
    message,
    clientId,
    durationMs: now() - started
  })

  let tls: TlsMaterial = {}
  if (profile.protocol === 'wss' && hasTlsFiles(profile.tls)) {
    try {
      tls = await loadTlsMaterial(profile.tls, { readFile: options.readFile })
    } catch (err) {
      return result(false, errorMessage(err))
    }
  }

  const open =
    options.open ?? (connectionKind(profile) === 'socketio' ? openSocketIo : openWebSocket)
  return new Promise<ConnectionTestResult>((resolve) => {
    let done = false
    const finish = (outcome: ConnectionTestResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      transport.close()
      resolve(outcome)
    }
    const timer = setTimeout(
      () => finish(result(false, 'Connection timed out')),
      options.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS
    )
    const transport = open(profile, tls, {
      onOpen: (id) => finish(result(true, 'Connected', id ?? '')),
      onMessage: () => {},
      onClose: (error) => finish(result(false, error))
    })
  })
}
