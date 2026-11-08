/**
 * `ConnectionsRepo.importProfiles` / `exportProfiles` with the real repository and file:
 * fresh identities, duplicates, TLS paths an import must not keep, limits and strict validation.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnectionProfile, createSubscription, isGeneratedClientId } from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import {
  type ConnectionsFile,
  ConnectionsRepo
} from '../../../src/main/services/storage/connections-repo'
import { JsonFile } from '../../../src/main/services/storage/json-file'
import { PLAIN_CIPHER } from '../../../src/main/services/storage/secrets'

let dir: string
let file: JsonFile<ConnectionsFile>
let repo: ConnectionsRepo

function open(folder: string): { repo: ConnectionsRepo; file: JsonFile<ConnectionsFile> } {
  const json = new JsonFile<ConnectionsFile>(folder, 'connections', {
    logger: { warn: vi.fn(), error: vi.fn() }
  })
  return { repo: new ConnectionsRepo(json, PLAIN_CIPHER, { warn: vi.fn() }), file: json }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mqtey-import-'))
  ;({ repo, file } = open(dir))
})

afterEach(() => {
  // Before the folder goes: a debounced write would create it again.
  file.flush()
  rmSync(dir, { recursive: true, force: true })
})

function sample(name: string, overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return createConnectionProfile({ name, ...overrides })
}

/** The export of `profiles`, made by a repository of another profile folder. */
function exported(profiles: ConnectionProfile[], includeSecrets = false): unknown {
  const folder = mkdtempSync(join(tmpdir(), 'mqtey-export-'))
  try {
    const source = open(folder)
    for (const profile of profiles) source.repo.save(profile)
    source.file.flush()
    return JSON.parse(source.repo.exportProfiles(undefined, { includeSecrets }))
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

describe('export', () => {
  it('leaves the secrets out by default and writes them only when asked', () => {
    const a = repo.save(sample('A', { password: 'pw-a' }))
    repo.save(sample('B'))
    repo.markConnected(a.id, 99)

    const all = JSON.parse(repo.exportProfiles())
    expect(all).toMatchObject({ app: 'mqtey', version: 1 })
    expect(all.connections.map((p: ConnectionProfile) => p.name)).toEqual(['A', 'B'])
    expect(all.connections[0].password).toBe('')
    expect(all.connections[0]).not.toHaveProperty('lastConnectedAt')
    expect(
      JSON.parse(repo.exportProfiles(undefined, { includeSecrets: true })).connections[0]
    ).toMatchObject({ password: 'pw-a' })
    expect(JSON.parse(repo.exportProfiles([a.id, 'unknown'])).connections).toHaveLength(1)
  })
})

describe('import', () => {
  it('gives an export fresh ids and renames clashing names', () => {
    const original = sample('Local', {
      password: 'pw',
      subscriptions: [createSubscription({ topic: 'a/#' }), createSubscription({ topic: 'b' })]
    })
    const data = exported([original], true)
    repo.save(sample('Local'))
    const { imported, skipped, duplicates } = repo.importProfiles(data)

    expect([skipped, duplicates]).toEqual([[], 0])
    const [copy] = imported
    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe('Local (imported)')
    expect(copy.password).toBe('pw')
    expect(copy.subscriptions.map((s) => s.topic)).toEqual(['a/#', 'b'])
    expect(copy.subscriptions.map((s) => s.id)).not.toEqual(original.subscriptions.map((s) => s.id))
    expect(repo.list().map((p) => p.name)).toEqual(['Local', 'Local (imported)'])
  })

  it('skips connections that are saved already: importing an export twice adds nothing', () => {
    const saved = ['A', 'B', 'C'].map((name) => repo.save(sample(name, { password: name })))
    const data = JSON.parse(repo.exportProfiles())
    const result = repo.importProfiles(data)
    expect(result).toMatchObject({ imported: [], skipped: [], duplicates: 3, source: 'mqtey' })
    expect(repo.list().map((p) => p.id)).toEqual(saved.map((p) => p.id))
  })

  it('regenerates a client id that mqtey generated, and keeps a custom one', () => {
    const generated = sample('Generated')
    const custom = sample('Custom', { clientId: 'plant-gw-1' })
    expect(isGeneratedClientId(generated.clientId)).toBe(true)
    const { imported } = repo.importProfiles(exported([generated, custom]))
    expect(imported[0].clientId).not.toBe(generated.clientId)
    expect(isGeneratedClientId(imported[0].clientId)).toBe(true)
    expect(imported[1].clientId).toBe('plant-gw-1')
  })

  it('clears UNC, device and relative TLS paths (with the passphrase) and keeps local ones', () => {
    const tls = createConnectionProfile().tls
    const entry = (name: string, paths: Partial<typeof tls>): Record<string, unknown> => ({
      name,
      host: 'broker.local',
      protocol: 'mqtts',
      tls: { ...tls, passphrase: 'key-pass', ...paths }
    })
    const result = repo.importProfiles([
      entry('UNC', { caPath: '\\\\192.0.2.1\\share\\ca.pem' }),
      entry('Device', { keyPath: '\\\\?\\C:\\certs\\key.pem' }),
      entry('Relative', { certPath: 'certs/client.pem', keyPath: 'key.pem' }),
      entry('Local', { caPath: 'C:/certs/ca.pem', keyPath: '/etc/ssl/ca.pem' })
    ])
    expect(result.tlsPathsCleared).toBe(3)
    const byName = Object.fromEntries(result.imported.map((p) => [p.name, p.tls]))
    expect(byName.UNC).toMatchObject({ caPath: '', passphrase: 'key-pass' })
    expect(byName.Device).toMatchObject({ keyPath: '', passphrase: '' })
    expect(byName.Relative).toMatchObject({ certPath: '', keyPath: '', passphrase: '' })
    expect(byName.Local).toMatchObject({
      caPath: 'C:/certs/ca.pem',
      keyPath: '/etc/ssl/ca.pem',
      passphrase: 'key-pass'
    })
  })

  it('refuses files with more than 1,000 entries', () => {
    const entries = Array.from({ length: 1_001 }, (_, i) => ({ name: `B${i}`, host: 'h' }))
    expect(() => repo.importProfiles(entries)).toThrow(
      'The file has 1,001 connections; at most 1,000 can be imported at once'
    )
    expect(repo.list()).toEqual([])
  })

  it('imports 1,000 entries with one name quickly, each with a unique name', () => {
    const entries = Array.from({ length: 1_000 }, (_, i) => ({
      name: 'Broker',
      host: 'h',
      clientId: `id-${i}`
    }))
    const started = performance.now()
    const { imported } = repo.importProfiles(entries)
    const elapsed = performance.now() - started
    expect(imported).toHaveLength(1_000)
    expect(new Set(imported.map((p) => p.name)).size).toBe(1_000)
    expect(imported.slice(0, 3).map((p) => p.name)).toEqual([
      'Broker',
      'Broker (imported)',
      'Broker (imported 2)'
    ])
    expect(elapsed).toBeLessThan(300)
  })

  it('validates like a save: no URL or credentials in the host, no reconnect flood', () => {
    const result = repo.importProfiles([
      { name: 'Credentials', host: 'bob:pw@127.0.0.1' },
      { name: 'Flood', host: 'h', autoReconnect: true, reconnectPeriod: 1 },
      { name: 'No reconnect', host: 'h', autoReconnect: false, reconnectPeriod: 1 },
      { name: 'Too long', host: 'h', clientId: '€'.repeat(21_846) },
      { name: 'No host' }
    ])
    expect(result.imported.map((p) => p.name)).toEqual(['No reconnect'])
    expect(result.skipped.map((s) => [s.name, s.reason])).toEqual([
      ['Credentials', 'host: Enter only the host name (no mqtt://, path, port or credentials)'],
      ['Flood', 'reconnectPeriod: Reconnect period must be at least 100 ms with auto reconnect on'],
      ['Too long', 'clientId: Client ID is too long (max 65535 bytes)'],
      ['No host', 'host: Host is required']
    ])
  })

  it('imports a plain array or a single profile and skips invalid entries', () => {
    const result = repo.importProfiles([
      { name: 'Minimal', host: 'broker.hivemq.com' },
      { name: 'Bad port', host: 'h', port: 99_999 },
      'not an object'
    ])
    expect(result.imported.map((p) => p.name)).toEqual(['Minimal'])
    expect(result.imported[0].port).toBe(1883)
    expect(result.skipped).toHaveLength(2)
    expect(result.skipped[0]).toMatchObject({ index: 1, name: 'Bad port' })
    expect(result.skipped[0].reason).toContain('port')

    expect(repo.importProfiles({ name: 'Single', host: 'h' }).imported[0].name).toBe('Single')
    expect(() => repo.importProfiles(42)).toThrow(/Unrecognized file/)
    expect(() => repo.importProfiles({ connections: 'nope' })).toThrow(/must be a list/)
  })

  it('saves what it imported', () => {
    repo.importProfiles([{ name: 'Kept', host: 'h' }])
    file.flush()
    const stored = JSON.parse(readFileSync(join(dir, 'connections.json'), 'utf8'))
    expect(stored.connections.map((p: ConnectionProfile) => p.name)).toEqual(['Kept'])
  })
})
