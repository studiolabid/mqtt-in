import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:tls'
import { Aedes } from 'aedes'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createConnectionProfile } from '@shared/defaults'
import type { ConnectionProfile, TlsSettings } from '@shared/models'
import { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import { createRecorder, type Recorder, waitFor } from './helpers/broker'
import { CERT_PEM, encryptedKeyPem, KEY_PEM, pemToDer } from './helpers/tls-fixtures'

const dir = mkdtempSync(join(tmpdir(), 'mqtey-tls-it-'))
let broker: Aedes
let server: Server
let port = 0
let manager: MqttManager | null = null

beforeAll(async () => {
  broker = await Aedes.createBroker()
  server = createServer({ cert: CERT_PEM, key: KEY_PEM }, broker.handle)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  await manager?.disposeAll(1000)
  manager = null
})

afterAll(async () => {
  await new Promise<void>((resolve) => broker.close(() => resolve()))
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

function file(name: string, content: string | Buffer): string {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

function setup(tls: Partial<TlsSettings>): { profile: ConnectionProfile; recorder: Recorder } {
  const base = createConnectionProfile({
    protocol: 'mqtts',
    host: '127.0.0.1',
    port,
    protocolVersion: 4,
    autoReconnect: true,
    reconnectPeriod: 100,
    connectTimeout: 3000
  })
  // The test certificate is self-signed for CN=mqtey-test.
  const profile = { ...base, tls: { ...base.tls, servername: 'mqtey-test', ...tls } }
  const recorder = createRecorder()
  manager = new MqttManager({
    profiles: { get: (id) => (id === profile.id ? profile : undefined) },
    sink: recorder.sink,
    batcher: { intervalMs: 5 }
  })
  return { profile, recorder }
}

describe('MqttManager with TLS files (real mqtt.js, local TLS broker)', () => {
  it('reads the CA, certificate and key and connects', async () => {
    const { profile, recorder } = setup({
      caPath: file('ca.pem', CERT_PEM),
      certPath: file('client.pem', CERT_PEM),
      keyPath: file('client.key', KEY_PEM)
    })
    await manager?.connect(profile.id)
    await waitFor(() => recorder.status.find((s) => s.status === 'connected'), 5000, 'connected')
    expect(recorder.logs.filter((l) => l.level === 'error')).toEqual([])
  })

  it('reports a wrong key passphrase before connecting, and leaves no session connecting', async () => {
    const { profile, recorder } = setup({
      caPath: file('ca2.pem', CERT_PEM),
      certPath: file('client2.pem', CERT_PEM),
      keyPath: file('encrypted.key', encryptedKeyPem('right')),
      passphrase: 'wrong'
    })
    await manager?.connect(profile.id)
    const failed = await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    expect(failed.error).toBe('Cannot decrypt the private key — check the passphrase')
    expect(recorder.logs.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([
      failed.error
    ])
    expect(manager?.getSessions()).toEqual([expect.objectContaining({ status: 'error' })])
    expect(recorder.status.some((s) => s.status === 'reconnecting')).toBe(false)
  })

  it('asks for PEM when the client certificate is a DER .cer file', async () => {
    const { profile, recorder } = setup({
      certPath: file('client.cer', pemToDer(CERT_PEM)),
      keyPath: file('client3.key', KEY_PEM)
    })
    await manager?.connect(profile.id)
    const failed = await waitFor(() => recorder.status.find((s) => s.status === 'error'))
    expect(failed.error).toBe('Invalid client certificate file (PEM expected)')
    expect(manager?.getSessions().map((s) => s.status)).toEqual(['error'])
  })
})
