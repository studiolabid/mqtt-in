import { afterEach, describe, expect, it } from 'vitest'
import { createConnectionProfile } from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import {
  createRecorder,
  type Recorder,
  sleep,
  startBroker,
  type TestBroker,
  waitFor
} from './helpers/broker'

/** Settings that do not match the broker: the error says which setting to change. */

let manager: MqttManager | null = null
let server: TestBroker | null = null

afterEach(async () => {
  await manager?.disposeAll(1000)
  await server?.close()
  manager = null
  server = null
})

function setup(overrides: Partial<ConnectionProfile>): {
  profile: ConnectionProfile
  recorder: Recorder
  manager: MqttManager
} {
  const profile = createConnectionProfile({
    host: '127.0.0.1',
    protocolVersion: 4,
    clientId: 'mqtey_test',
    autoReconnect: false,
    connectTimeout: 2000,
    ...overrides
  })
  const recorder = createRecorder()
  manager = new MqttManager({
    profiles: { get: (id) => (id === profile.id ? profile : undefined) },
    sink: recorder.sink,
    batcher: { intervalMs: 5 }
  })
  return { profile, recorder, manager }
}

describe('settings that do not match the broker', () => {
  it('points to the TLS port when an mqtts URL meets a plain MQTT port (MQ-18)', async () => {
    server = await startBroker()
    const { profile, recorder, manager } = setup({ protocol: 'mqtts', port: server.port })
    await manager.connect(profile.id)
    const failed = await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    expect(failed.error).toBe(
      'TLS handshake failed — the broker closed the connection. Is this port TLS-enabled (usually 8883)?'
    )
  })

  it('points to the WebSocket port and path when a ws URL meets a TCP port (MQ-18)', async () => {
    server = await startBroker()
    const { profile, recorder, manager } = setup({ protocol: 'ws', port: server.port })
    await manager.connect(profile.id)
    const failed = await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    expect(failed.error).toBe(
      'The broker closed the connection — is this a WebSocket port and path?'
    )
  })

  it('stops at once when an MQTT 5 profile meets a 3.1.1-only broker', async () => {
    server = await startBroker() // aedes speaks MQTT 3.1.1 only: CONNACK return code 1
    const { profile, recorder, manager } = setup({
      port: server.port,
      protocolVersion: 5,
      autoReconnect: true,
      reconnectPeriod: 50
    })
    await manager.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    await sleep(300)
    const message = 'The broker does not support MQTT 5.0 — switch this connection to MQTT 3.1.1'
    expect(recorder.status.map((s) => s.status)).toEqual(['connecting', 'error'])
    expect(recorder.status.at(-1)?.error).toBe(message)
    const errors = recorder.logs.filter((l) => l.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ message, detail: expect.stringContaining('not retrying') })
  })
})
