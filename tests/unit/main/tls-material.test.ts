import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectionProfile } from '@shared/defaults'
import type { TlsSettings } from '@shared/models'
import {
  checkTlsMaterial,
  loadTlsMaterial,
  TLS_READ_TIMEOUT_MS
} from '../../../src/main/services/mqtt/tls-material'
import type { ReadFileFn } from '../../../src/main/services/mqtt/types'
import { CERT_PEM, encryptedKeyPem, KEY_PEM, otherKeyPem, pemToDer } from './helpers/tls-fixtures'

const dir = mkdtempSync(join(tmpdir(), 'mqtt-in-tls-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => {
  vi.useRealTimers()
})

function file(name: string, content: string | Buffer): string {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

function tls(overrides: Partial<TlsSettings>): TlsSettings {
  return { ...createConnectionProfile().tls, ...overrides }
}

const failing =
  (code: string): ReadFileFn =>
  () =>
    Promise.reject(Object.assign(new Error(`${code}: scripted`), { code }))

describe('loadTlsMaterial — reading', () => {
  it('reads the files asynchronously and returns their contents', async () => {
    const material = await loadTlsMaterial(
      tls({
        caPath: file('ca.pem', CERT_PEM),
        certPath: file('c.pem', CERT_PEM),
        keyPath: ` ${file('k.pem', KEY_PEM)} `
      })
    )
    expect(material.ca?.toString()).toBe(CERT_PEM)
    expect(material.cert?.toString()).toBe(CERT_PEM)
    expect(material.key?.toString()).toBe(KEY_PEM)
    expect(await loadTlsMaterial(tls({}))).toEqual({})
  })

  it('maps file system errors to human text', async () => {
    await expect(loadTlsMaterial(tls({ caPath: join(dir, 'missing.pem') }))).rejects.toThrow(
      `Cannot read CA file ${join(dir, 'missing.pem')}: file not found`
    )
    await expect(loadTlsMaterial(tls({ certPath: dir }))).rejects.toThrow(
      `Cannot read client certificate file ${dir}: it is a directory`
    )
    await expect(
      loadTlsMaterial(tls({ keyPath: '/k.pem' }), { readFile: failing('EACCES') })
    ).rejects.toThrow('Cannot read client key file /k.pem: permission denied')
  })

  it('refuses files over 1 MB without reading them', async () => {
    const big = file('big.pem', Buffer.alloc(1024 * 1024 + 1, 0x41))
    await expect(loadTlsMaterial(tls({ caPath: big }))).rejects.toThrow(
      'CA file is larger than 1 MB'
    )
    // A reader that ignores maxBytes is checked too.
    const huge: ReadFileFn = () => Promise.resolve(Buffer.alloc(2 * 1024 * 1024))
    await expect(loadTlsMaterial(tls({ keyPath: '/k' }), { readFile: huge })).rejects.toThrow(
      'Client key file is larger than 1 MB'
    )
  })

  it('reports an unreachable network share', async () => {
    for (const code of ['UNKNOWN', 'ETIMEDOUT', 'EHOSTDOWN', 'EHOSTUNREACH']) {
      const share = String.raw`\\192.0.2.1\share\ca.pem`
      await expect(
        loadTlsMaterial(tls({ caPath: share }), { readFile: failing(code) })
      ).rejects.toThrow(
        String.raw`Cannot reach \\192.0.2.1\share\ca.pem (network share unavailable)`
      )
    }
  })

  it('gives up on a read that never settles after the timeout, and aborts it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const signals: AbortSignal[] = []
    const never: ReadFileFn = (_path, { signal }) => {
      signals.push(signal)
      return new Promise<Buffer>(() => {})
    }
    const loading = loadTlsMaterial(tls({ caPath: '/net/ca.pem', keyPath: '/net/k.pem' }), {
      readFile: never
    })
    const settled = vi.fn()
    loading.then(settled, settled)
    await vi.advanceTimersByTimeAsync(TLS_READ_TIMEOUT_MS - 1)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(loading).rejects.toThrow('Cannot reach /net/ca.pem (network share unavailable)')
    // One file at a time: the key was never asked for once the CA timed out.
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(true)
  })
})

describe('checkTlsMaterial', () => {
  const cert = Buffer.from(CERT_PEM)
  const key = Buffer.from(KEY_PEM)

  it('accepts a matching certificate and key, and a CA bundle', () => {
    expect(() => checkTlsMaterial({ ca: cert, cert, key }, '')).not.toThrow()
  })

  it('explains a wrong or missing passphrase of an encrypted key', () => {
    const encrypted = Buffer.from(encryptedKeyPem('right'))
    expect(() => checkTlsMaterial({ key: encrypted }, 'wrong')).toThrow(
      'Cannot decrypt the private key — check the passphrase'
    )
    expect(() => checkTlsMaterial({ key: encrypted }, '')).toThrow(
      'The client key is encrypted — enter its passphrase'
    )
    expect(() => checkTlsMaterial({ key: encrypted }, 'right')).not.toThrow()
  })

  it('asks for PEM when a file is DER or not a certificate / key at all', () => {
    const der = pemToDer(CERT_PEM)
    expect(() => checkTlsMaterial({ ca: der }, '')).toThrow('Invalid CA file (PEM expected)')
    expect(() => checkTlsMaterial({ cert: der }, '')).toThrow(
      'Invalid client certificate file (PEM expected)'
    )
    expect(() => checkTlsMaterial({ key: Buffer.from('[boot loader]') }, '')).toThrow(
      'Invalid client key file (PEM expected)'
    )
    // Node would silently accept a key file as CA bundle and then trust nothing.
    expect(() => checkTlsMaterial({ ca: key }, '')).toThrow('The CA file contains no certificate')
    expect(() => checkTlsMaterial({ key: cert }, '')).toThrow(
      'The client key file contains no private key'
    )
  })

  it('notices a certificate that does not belong to the key', () => {
    expect(() => checkTlsMaterial({ cert, key: Buffer.from(otherKeyPem()) }, '')).toThrow(
      'The client certificate does not match the private key'
    )
  })
})
