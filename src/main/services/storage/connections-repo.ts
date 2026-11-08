/**
 * Persisted connection profiles (`connections.json`), in sidebar order.
 *
 * Profiles are kept in memory with plain-text secrets; `password` and `tls.passphrase`
 * are sealed with the injected cipher only when written to disk.
 *
 * A stored secret that cannot be decrypted on this system (keyring locked, keychain access
 * denied, a profile folder from another machine) is kept as its ciphertext and written back
 * unchanged, so no unrelated write ever erases it: the profile shows an empty password until
 * the user enters a new one, which replaces it. One 'secrets-unavailable' notice says so.
 * Stored entries that no longer validate are skipped ('invalid-entries', with a copy of the
 * original file).
 */
import { normalizeConnectionProfile } from '@shared/defaults'
import type { ConnectionProfile, ExportConnectionsOptions, StorageNotice } from '@shared/models'
import { safeParseConnectionProfile } from '../../schemas/profile'
import { isRecord } from '../../utils/errors'
import { planImport } from './connections-import'
import { buildExport, type ImportResult } from './connections-transfer'
import type { JsonFile } from './json-file'
import { openStoredSecret, sealSecret, type SecretCipher } from './secrets'

/** On-disk shape of `connections.json` (entries validated on load). */
export interface ConnectionsFile {
  version: number
  connections: unknown[]
}

export interface ConnectionsRepoOptions {
  now?: () => number
  warn?: (message: string) => void
  /** Receives the problems the user must hear about (see `StorageNotices`). */
  onNotice?: (notice: StorageNotice) => void
}

/** Ciphertexts kept because they cannot be decrypted here (per profile id). */
interface SealedSecrets {
  password?: string
  passphrase?: string
}

const EMPTY_FILE: ConnectionsFile = { version: 1, connections: [] }
const FILE_NAME = 'connections.json'

/** Accepts `{ version, connections: [...] }` and (legacy) a plain array. */
function parseConnectionsFile(raw: unknown): ConnectionsFile {
  if (Array.isArray(raw)) return { version: 1, connections: raw }
  if (isRecord(raw) && Array.isArray(raw.connections)) {
    return {
      version: typeof raw.version === 'number' ? raw.version : 1,
      connections: raw.connections
    }
  }
  throw new Error('expected { "connections": [...] }')
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** 'N saved passwords cannot be decrypted on this system. They are kept unchanged; …' */
function undecryptableMessage(passwords: number, passphrases: number): string {
  const total = passwords + passphrases
  const what =
    passphrases === 0
      ? plural(total, 'saved password', 'saved passwords')
      : passwords === 0
        ? plural(total, 'saved TLS passphrase', 'saved TLS passphrases')
        : `${total} saved passwords and TLS passphrases`
  const [subject, object] = total === 1 ? ['It is', 'it'] : ['They are', 'them']
  return (
    `${what} cannot be decrypted on this system. ${subject} kept unchanged; enter ${object} ` +
    `again to replace ${object}.`
  )
}

export class ConnectionsRepo {
  private profiles: ConnectionProfile[]
  private readonly sealed = new Map<string, SealedSecrets>()
  private readonly now: () => number
  private readonly warn: (message: string) => void
  private readonly onNotice?: (notice: StorageNotice) => void

  constructor(
    private readonly file: JsonFile<ConnectionsFile>,
    private readonly cipher: SecretCipher,
    options: ConnectionsRepoOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.warn = options.warn ?? console.warn
    this.onNotice = options.onNotice
    this.profiles = this.restore(file.load(EMPTY_FILE, parseConnectionsFile).connections)
  }

  /** Every profile in persisted order (copies, plain-text secrets). */
  list(): ConnectionProfile[] {
    return this.profiles.map((profile) => structuredClone(profile))
  }

  get(id: string): ConnectionProfile | undefined {
    const profile = this.profiles.find((p) => p.id === id)
    return profile ? structuredClone(profile) : undefined
  }

  /**
   * Inserts or updates by id (normalized, `updatedAt` refreshed). Returns the stored copy.
   * A non-empty password or passphrase replaces a kept undecryptable one; an empty one keeps it.
   */
  save(profile: ConnectionProfile): ConnectionProfile {
    const normalized = normalizeConnectionProfile(profile)
    const index = this.profiles.findIndex((p) => p.id === normalized.id)
    const existing = index >= 0 ? this.profiles[index] : undefined
    const stored: ConnectionProfile = {
      ...normalized,
      createdAt: existing?.createdAt ?? normalized.createdAt,
      updatedAt: this.now()
    }
    const lastConnectedAt = latest(existing?.lastConnectedAt, normalized.lastConnectedAt)
    if (lastConnectedAt === undefined) delete stored.lastConnectedAt
    else stored.lastConnectedAt = lastConnectedAt
    this.replaceSealed(stored)

    if (index >= 0) this.profiles[index] = stored
    else this.profiles.push(stored)
    this.persist()
    return structuredClone(stored)
  }

  /** Removes a profile. Returns false when the id is unknown. */
  remove(id: string): boolean {
    const next = this.profiles.filter((p) => p.id !== id)
    if (next.length === this.profiles.length) return false
    this.profiles = next
    this.sealed.delete(id)
    this.persist()
    return true
  }

  /** Applies a sidebar order: unknown ids are ignored, profiles not listed keep their order at the end. */
  reorder(ids: readonly string[]): void {
    const remaining = new Map(this.profiles.map((p) => [p.id, p]))
    const ordered: ConnectionProfile[] = []
    for (const id of ids) {
      const profile = remaining.get(id)
      if (!profile) continue
      ordered.push(profile)
      remaining.delete(id)
    }
    ordered.push(...this.profiles.filter((p) => remaining.has(p.id)))
    if (ordered.every((p, i) => p === this.profiles[i])) return
    this.profiles = ordered
    this.persist()
  }

  /** Records a successful connection (does not touch `updatedAt`). */
  markConnected(id: string, at: number): void {
    const profile = this.profiles.find((p) => p.id === id)
    if (!profile || (profile.lastConnectedAt ?? 0) >= at) return
    profile.lastConnectedAt = at
    this.persist()
  }

  /**
   * Imports profiles from parsed JSON (see `planImport`): valid entries get fresh ids and are
   * saved; duplicates of saved connections and invalid entries are not. Throws a human error
   * when the data has no recognizable shape or too many entries.
   */
  importProfiles(data: unknown): ImportResult {
    const result = planImport(data, {
      existing: this.profiles,
      openSecrets: (entry) => this.openSecrets(entry).entry,
      now: this.now()
    })
    if (result.imported.length > 0) {
      this.profiles.push(...result.imported)
      this.persist()
    }
    return { ...result, imported: result.imported.map((p) => structuredClone(p)) }
  }

  /**
   * JSON export of the given ids (all when omitted), in persisted order. Passwords and TLS
   * passphrases are left out unless `options.includeSecrets` (see `buildExport`).
   */
  exportProfiles(ids?: readonly string[], options: ExportConnectionsOptions = {}): string {
    const wanted = ids ? new Set(ids) : null
    return buildExport(
      this.profiles.filter((p) => !wanted || wanted.has(p.id)),
      options
    )
  }

  /** Validates the stored entries leniently (an older profile is never dropped for new rules). */
  private restore(entries: unknown[]): ConnectionProfile[] {
    const profiles: ConnectionProfile[] = []
    const seen = new Set<string>()
    let invalid = 0
    let passwords = 0
    let passphrases = 0
    for (const entry of entries) {
      const opened = this.openSecrets(entry)
      const result = safeParseConnectionProfile(opened.entry, 'lenient')
      if (!result.ok) {
        invalid++
        this.warn(`[storage] Skipped an invalid connection (${result.error})`)
        continue
      }
      if (seen.has(result.value.id)) continue
      seen.add(result.value.id)
      profiles.push(result.value)
      if (opened.sealed) {
        this.sealed.set(result.value.id, opened.sealed)
        if (opened.sealed.password !== undefined) passwords++
        if (opened.sealed.passphrase !== undefined) passphrases++
      }
    }
    if (invalid > 0) this.reportInvalid(invalid)
    if (passwords + passphrases > 0) {
      this.notify('secrets-unavailable', undecryptableMessage(passwords, passphrases))
    }
    return profiles
  }

  private reportInvalid(count: number): void {
    const backup = this.file.backup('invalid')
    if (backup) this.warn(`[storage] The original connections file was copied to ${backup}`)
    this.notify(
      'invalid-entries',
      `${plural(count, 'saved connection', 'saved connections')} could not be read and ` +
        `${count === 1 ? 'was' : 'were'} left out.` +
        (backup ? ' A copy of the original file was kept.' : ''),
      backup ?? undefined
    )
  }

  /**
   * Decrypts `password` / `tls.passphrase` of a raw entry (before validation). `sealed` holds the
   * ciphertexts that cannot be decrypted (their plain text is `''`).
   */
  private openSecrets(entry: unknown): { entry: unknown; sealed?: SealedSecrets } {
    if (!isRecord(entry)) return { entry }
    const copy: Record<string, unknown> = { ...entry }
    const sealed: SealedSecrets = {}
    if (typeof copy.password === 'string') {
      const opened = openStoredSecret(copy.password, this.cipher, this.warn)
      copy.password = opened.value
      if (opened.sealed) sealed.password = opened.sealed
    }
    if (isRecord(copy.tls) && typeof copy.tls.passphrase === 'string') {
      const opened = openStoredSecret(copy.tls.passphrase, this.cipher, this.warn)
      copy.tls = { ...copy.tls, passphrase: opened.value }
      if (opened.sealed) sealed.passphrase = opened.sealed
    }
    return Object.keys(sealed).length > 0 ? { entry: copy, sealed } : { entry: copy }
  }

  /** A new non-empty secret replaces the kept ciphertext of that field. */
  private replaceSealed(profile: ConnectionProfile): void {
    const kept = this.sealed.get(profile.id)
    if (!kept) return
    if (profile.password !== '') delete kept.password
    if (profile.tls.passphrase !== '') delete kept.passphrase
    if (kept.password === undefined && kept.passphrase === undefined) this.sealed.delete(profile.id)
  }

  private seal(profile: ConnectionProfile): ConnectionProfile {
    const kept = this.sealed.get(profile.id)
    const seal = (value: string, keptValue: string | undefined): string =>
      value === '' && keptValue !== undefined
        ? keptValue
        : sealSecret(value, this.cipher, this.warn)
    return {
      ...profile,
      password: seal(profile.password, kept?.password),
      tls: { ...profile.tls, passphrase: seal(profile.tls.passphrase, kept?.passphrase) }
    }
  }

  private persist(): void {
    this.file.set({ version: 1, connections: this.profiles.map((p) => this.seal(p)) })
  }

  private notify(kind: StorageNotice['kind'], message: string, path?: string): void {
    if (!this.onNotice) return
    const notice: StorageNotice = { kind, file: FILE_NAME, message, timestamp: this.now() }
    if (path) notice.path = path
    this.onNotice(notice)
  }
}

function latest(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}
