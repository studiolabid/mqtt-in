import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import type { ConnectionProfile, StorageNotice } from '@shared/models'
import {
  type ConnectionsFile,
  ConnectionsRepo
} from '../../../src/main/services/storage/connections-repo'
import { JsonFile } from '../../../src/main/services/storage/json-file'
import {
  ENCRYPTED_PREFIX,
  PLAIN_CIPHER,
  type SecretCipher
} from '../../../src/main/services/storage/secrets'
import { failAlways, fsFaults, resetFsFaults } from './helpers/fs-faults'

vi.mock('node:fs', async (importOriginal) =>
  (await import('./helpers/fs-faults')).faultyFs(await importOriginal())
)

/** Reversible fake cipher: "X:" + text. */
const fakeCipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (text) => Buffer.from(`X:${text}`, 'utf8'),
  decrypt: (data) => {
    const text = data.toString('utf8')
    if (!text.startsWith('X:')) throw new Error('bad ciphertext')
    return text.slice(2)
  }
}
/** The same keychain, but it refuses to decrypt (keychain access denied, another machine). */
const refusingCipher: SecretCipher = {
  ...fakeCipher,
  decrypt: () => {
    throw new Error('wrong key')
  }
}

let dir: string
let clock: number
let notices: StorageNotice[]
/** Flushed before the folder is removed: a debounced write would create it again. */
let opened: JsonFile<ConnectionsFile>[] = []
const warn = vi.fn()
const logger = { warn: vi.fn(), error: vi.fn() }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mqtey-repo-'))
  clock = 1_000
  notices = []
  warn.mockClear()
})

afterEach(() => {
  resetFsFaults()
  for (const file of opened) file.flush()
  opened = []
  rmSync(dir, { recursive: true, force: true })
})

function openRepo(cipher: SecretCipher = fakeCipher): {
  repo: ConnectionsRepo
  file: JsonFile<ConnectionsFile>
} {
  const onNotice = (notice: StorageNotice): number => notices.push(notice)
  const file = new JsonFile<ConnectionsFile>(dir, 'connections', {
    logger,
    onNotice,
    readRetryDelayMs: 1
  })
  opened.push(file)
  const repo = new ConnectionsRepo(file, cipher, { now: () => ++clock, warn, onNotice })
  return { repo, file }
}

function readStored(): { connections: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(join(dir, 'connections.json'), 'utf8'))
}

function sample(name: string, overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return createConnectionProfile({ name, ...overrides })
}

/** Saves `profiles` with a working cipher and writes connections.json. */
function seed(...profiles: ConnectionProfile[]): void {
  const { repo, file } = openRepo()
  for (const profile of profiles) repo.save(profile)
  file.flush()
  notices = []
}

describe('ConnectionsRepo', () => {
  it('saves, lists in persisted order and refreshes updatedAt', () => {
    const { repo } = openRepo()
    const a = repo.save(sample('A'))
    const b = repo.save(sample('B'))
    expect(repo.list().map((p) => p.name)).toEqual(['A', 'B'])
    expect(a.updatedAt).toBeLessThan(b.updatedAt)

    const renamed = repo.save({ ...a, name: 'A2', createdAt: 5 })
    expect(renamed.updatedAt).toBeGreaterThan(b.updatedAt)
    expect(renamed.createdAt).toBe(a.createdAt)
    expect(repo.list().map((p) => p.name)).toEqual(['A2', 'B'])
  })

  it('returns copies', () => {
    const { repo } = openRepo()
    const saved = repo.save(sample('A'))
    const copy = repo.get(saved.id)
    if (!copy) throw new Error('missing profile')
    copy.name = 'mutated'
    copy.subscriptions.push(createSubscription())
    expect(repo.get(saved.id)?.name).toBe('A')
    expect(repo.get(saved.id)?.subscriptions).toHaveLength(0)
    expect(repo.get('nope')).toBeUndefined()
  })

  it('encrypts secrets at rest and decrypts them on load', () => {
    const { repo, file } = openRepo()
    const base = sample('Secure', { password: 'hunter2' })
    repo.save({ ...base, tls: { ...base.tls, passphrase: 'key-pass' } })
    file.flush()

    const stored = readStored().connections[0]
    expect(stored.password).toBe(
      `${ENCRYPTED_PREFIX}${Buffer.from('X:hunter2').toString('base64')}`
    )
    expect((stored.tls as Record<string, unknown>).passphrase).toMatch(/^enc:v1:/)
    expect(JSON.stringify(stored)).not.toContain('hunter2')

    const reopened = openRepo().repo.list()[0]
    expect(reopened.password).toBe('hunter2')
    expect(reopened.tls.passphrase).toBe('key-pass')
  })

  it('stores plain text when encryption is unavailable', () => {
    const { repo, file } = openRepo(PLAIN_CIPHER)
    repo.save(sample('A', { password: 'plain' }))
    file.flush()
    expect(readStored().connections[0].password).toBe('plain')
    expect(openRepo(PLAIN_CIPHER).repo.list()[0].password).toBe('plain')
  })

  it('reorders: unknown ids are ignored, missing ones are appended', () => {
    const { repo } = openRepo()
    const [a, b, c] = ['A', 'B', 'C'].map((name) => repo.save(sample(name)))
    repo.reorder([c.id, 'unknown', a.id, c.id])
    expect(repo.list().map((p) => p.id)).toEqual([c.id, a.id, b.id])
  })

  it('removes profiles', () => {
    const { repo } = openRepo()
    const a = repo.save(sample('A'))
    expect(repo.remove(a.id)).toBe(true)
    expect(repo.remove(a.id)).toBe(false)
    expect(repo.list()).toEqual([])
  })

  it('records the last connection time without touching updatedAt', () => {
    const { repo } = openRepo()
    const a = repo.save(sample('A'))
    repo.markConnected(a.id, 50_000)
    repo.markConnected(a.id, 40_000)
    expect(repo.get(a.id)?.lastConnectedAt).toBe(50_000)
    expect(repo.get(a.id)?.updatedAt).toBe(a.updatedAt)
    // A stale renderer copy must not erase it.
    expect(repo.save(a).lastConnectedAt).toBe(50_000)
  })

  it('accepts a legacy plain-array file', () => {
    writeFileSync(join(dir, 'connections.json'), JSON.stringify([sample('Legacy')]))
    expect(
      openRepo()
        .repo.list()
        .map((p) => p.name)
    ).toEqual(['Legacy'])
  })
})

describe('ConnectionsRepo: connections.json cannot be read at startup', () => {
  it('never drops the saved connections when the file is locked (EBUSY)', () => {
    seed(sample('One', { password: 's1' }), sample('Two'), sample('Three'))
    const before = readFileSync(join(dir, 'connections.json'), 'utf8')
    fsFaults.readFileSync = failAlways('connections.json')

    const { repo, file } = openRepo()
    expect(repo.list()).toEqual([])
    expect(file.writeBlocked).toBe(true)
    // The first save of the session (and any automatic write) must not replace the file.
    const added = repo.save(sample('My new connection'))
    repo.markConnected(added.id, 99)
    file.flush()

    resetFsFaults()
    expect(readFileSync(join(dir, 'connections.json'), 'utf8')).toBe(before)
    expect(readStored().connections.map((c) => c.name)).toEqual(['One', 'Two', 'Three'])
    expect(notices.map((notice) => notice.kind)).toEqual(['unreadable'])
  })
})

describe('ConnectionsRepo: secrets that cannot be decrypted', () => {
  function seedSecrets(): void {
    const base = sample('Secret 1', { password: 'pw-1' })
    seed(
      { ...base, tls: { ...base.tls, passphrase: 'key-1' } },
      sample('Secret 2', { password: 'pw-2' }),
      sample('No secret')
    )
  }

  it.each([
    ['the keyring is unavailable', { ...fakeCipher, isAvailable: () => false }],
    ['decrypting fails', refusingCipher]
  ])('keeps them unchanged on disk when %s', (_label, cipher) => {
    seedSecrets()
    const stored = readStored().connections.map((c) => c.password)
    const { repo, file } = openRepo(cipher)
    expect(repo.list().map((p) => p.password)).toEqual(['', '', ''])

    // Unrelated writes: a connect of another profile, a reorder, a new profile.
    const [first, second, third] = repo.list()
    repo.markConnected(third.id, 5_000)
    repo.reorder([second.id, first.id, third.id])
    repo.save({ ...first, name: 'Secret 1 renamed' })
    file.flush()

    const after = readStored().connections
    expect(after.map((c) => c.password)).toEqual([stored[1], stored[0], ''])
    for (const value of [after[0].password, after[1].password]) {
      expect(value).toMatch(/^enc:v1:/)
    }
    expect((after[1].tls as Record<string, unknown>).passphrase).toMatch(/^enc:v1:/)
    expect(notices).toEqual([
      {
        kind: 'secrets-unavailable',
        file: 'connections.json',
        message:
          '3 saved passwords and TLS passphrases cannot be decrypted on this system. They are ' +
          'kept unchanged; enter them again to replace them.',
        timestamp: expect.any(Number)
      }
    ])
  })

  it('replaces a kept secret with a newly entered one', () => {
    seedSecrets()
    const { repo, file } = openRepo(refusingCipher)
    const [first] = repo.list()
    repo.save({ ...first, password: 'new-password' })
    file.flush()
    expect(openRepo().repo.list()[0]).toMatchObject({
      password: 'new-password',
      tls: { passphrase: 'key-1' }
    })
  })

  it('says it once, in the singular for one password', () => {
    seed(sample('Only', { password: 'pw' }))
    openRepo(refusingCipher)
    expect(notices.map((notice) => notice.message)).toEqual([
      '1 saved password cannot be decrypted on this system. It is kept unchanged; enter it ' +
        'again to replace it.'
    ])
  })
})

describe('ConnectionsRepo: stored entries that no longer validate', () => {
  it('skips them, keeps a copy of the original file and says so', () => {
    const good = sample('Good')
    writeFileSync(
      join(dir, 'connections.json'),
      JSON.stringify({ version: 1, connections: [good, { name: 'Broken', port: 'x' }] })
    )
    const { repo } = openRepo()
    expect(repo.list().map((p) => p.name)).toEqual(['Good'])
    const copies = readdirSync(dir).filter((name) => name.startsWith('connections.invalid-'))
    expect(copies).toHaveLength(1)
    expect(notices).toEqual([
      {
        kind: 'invalid-entries',
        file: 'connections.json',
        message:
          '1 saved connection could not be read and was left out. A copy of the original file ' +
          'was kept.',
        path: join(dir, copies[0]),
        timestamp: expect.any(Number)
      }
    ])
  })

  it('still loads profiles that a save would refuse today (lenient restore)', () => {
    const legacy = sample('Legacy', {
      host: 'u:p@h',
      autoReconnect: true,
      reconnectPeriod: 1,
      clientId: '€'.repeat(21_846)
    })
    writeFileSync(
      join(dir, 'connections.json'),
      JSON.stringify({ version: 1, connections: [legacy] })
    )
    const { repo } = openRepo()
    expect(repo.list().map((p) => [p.name, p.host, p.reconnectPeriod])).toEqual([
      ['Legacy', 'u:p@h', 1]
    ])
    expect(notices).toEqual([])
  })
})
