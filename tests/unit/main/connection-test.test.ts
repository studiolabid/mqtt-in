import { afterEach, describe, expect, it } from 'vitest'
import { createConnectionProfile } from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import { testClientId, testConnection } from '../../../src/main/services/mqtt/connection-test'
import { freePort, startBroker, type TestBroker } from './helpers/broker'

let broker: TestBroker | null = null

afterEach(async () => {
  await broker?.close()
  broker = null
})

function profile(port: number, patch: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    ...createConnectionProfile(),
    host: '127.0.0.1',
    port,
    protocolVersion: 4,
    connectTimeout: 3000,
    ...patch
  }
}

describe('testConnection', () => {
  it('connects, reports success and disconnects cleanly', async () => {
    broker = await startBroker()
    const clients: string[] = []
    broker.broker.on('client', (client) => clients.push(client.id))
    let disconnected = false
    broker.broker.on('clientDisconnect', () => {
      disconnected = true
    })

    const result = await testConnection(profile(broker.port, { clientId: 'switch-test' }))

    expect(result).toMatchObject({ ok: true, message: 'Connected', clientId: 'switch-test' })
    expect(clients).toEqual(['switch-test'])
    await expect.poll(() => disconnected).toBe(true)
  })

  it('reports a refused login with the broker reason', async () => {
    broker = await startBroker({
      authenticate: (_client, _user, _password, done) => {
        const error = Object.assign(new Error('bad login'), { returnCode: 4 })
        done(error, false)
      }
    })

    const result = await testConnection(
      profile(broker.port, { username: 'sw-test', password: 'wrong' })
    )

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/^Connection refused: bad user name or password/i)
  })

  it('reports a port with no broker without throwing', async () => {
    const result = await testConnection(profile(await freePort()))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/refused|timed out/i)
  })

  it('reports settings that cannot be used before connecting', async () => {
    const result = await testConnection(profile(1883, { host: '   ' }))

    expect(result).toMatchObject({ ok: false, message: 'Host is required' })
  })
})

describe('testClientId', () => {
  it('reuses a fixed client id only for a clean, idle connection', () => {
    const base = profile(1883, { clientId: 'sw-12' })
    expect(testClientId({ ...base, clean: true }, false)).toBe('sw-12')
    expect(testClientId({ ...base, clean: true }, true)).toMatch(/^mqttin_[0-9a-f]{8}$/)
    expect(testClientId({ ...base, clean: false }, false)).toMatch(/^mqttin_[0-9a-f]{8}$/)
    expect(testClientId({ ...base, clientId: '' }, false)).toMatch(/^mqttin_[0-9a-f]{8}$/)
  })
})
