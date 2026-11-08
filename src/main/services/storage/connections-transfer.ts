/**
 * Pure helpers for importing and exporting connection profiles: the export file, the shapes an
 * import accepts, the entry limit, unique names, duplicate detection, TLS paths an import may
 * keep, and the IPC outcome. No file system access (an import never touches the paths it reads).
 */
import { APP_NAME, isWebSocketProtocol } from '@shared/defaults'
import type {
  ConnectionProfile,
  ExportConnectionsOptions,
  ImportConnectionsResult,
  ImportSkippedEntry,
  TlsSettings
} from '@shared/models'
import { isRecord } from '../../utils/errors'
import { flattenMqttxCollections, isMqttxEntry } from './import-mqttx'

/** Version of the export file format written by `buildExport`. */
export const EXPORT_VERSION = 1

/** At most this many skipped entries are listed in an `ImportConnectionsResult`. */
export const MAX_LISTED_SKIPS = 20

/** Larger files are refused: an import runs on the main process, which serves every window. */
export const MAX_IMPORT_ENTRIES = 1000

export interface ImportSkip extends ImportSkippedEntry {
  /** Position of the entry in the imported list. */
  index: number
}

/** What `ConnectionsRepo.importProfiles` did (`toImportConnectionsResult` makes the IPC result). */
export interface ImportResult {
  imported: ConnectionProfile[]
  /** Every skipped entry. */
  skipped: ImportSkip[]
  /** Entries identical to a saved connection, or to an earlier entry (see `connectionIdentity`). */
  duplicates: number
  /** Imported profiles whose TLS file paths were cleared (see `withImportableTlsPaths`). */
  tlsPathsCleared: number
  source: ImportConnectionsResult['source']
}

/** The IPC outcome of an import: the skipped entries without positions, at most 20 listed. */
export function toImportConnectionsResult(result: ImportResult): ImportConnectionsResult {
  return {
    imported: result.imported,
    skipped: result.skipped
      .slice(0, MAX_LISTED_SKIPS)
      .map(({ name, reason }) => (name === undefined ? { reason } : { name, reason })),
    duplicates: result.duplicates,
    tlsPathsCleared: result.tlsPathsCleared,
    source: result.source
  }
}

const UNRECOGNIZED =
  'Unrecognized file: expected an mqtey or MQTTX connections export, or a single connection'

function isObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value)
}

/** One connection on its own (an mqtey profile has a host; MQTTX has its own keys). */
function isSingleConnection(data: Record<string, unknown>): boolean {
  return typeof data.host === 'string' || isMqttxEntry(data)
}

/**
 * The profile-like entries of an import file: an mqtey export or a raw `connections.json`
 * (`{ connections: [...] }`), a list (the legacy file, or an MQTTX export, collections included),
 * or a single connection. Anything else (another app's JSON) is refused with a human error.
 */
export function extractImportCandidates(data: unknown): unknown[] {
  if (Array.isArray(data)) return flattenMqttxCollections(data)
  if (isObject(data)) {
    if (Array.isArray(data.connections)) return flattenMqttxCollections(data.connections)
    if ('connections' in data) throw new Error('Unrecognized file: "connections" must be a list')
    if (isSingleConnection(data)) return [data]
  }
  throw new Error(UNRECOGNIZED)
}

/** The entries of an import file and its format; refuses more than `MAX_IMPORT_ENTRIES`. */
export function readImportFile(data: unknown): {
  candidates: unknown[]
  source: ImportConnectionsResult['source']
} {
  const candidates = extractImportCandidates(data)
  if (candidates.length > MAX_IMPORT_ENTRIES) {
    const count = candidates.length.toLocaleString('en-US')
    const max = MAX_IMPORT_ENTRIES.toLocaleString('en-US')
    throw new Error(`The file has ${count} connections; at most ${max} can be imported at once`)
  }
  const source = candidates.some(isMqttxEntry)
    ? 'mqttx'
    : isObject(data) && !('connections' in data)
      ? 'profile'
      : 'mqtey'
  return { candidates, source }
}

/** Display name of a raw entry, for error reports. */
export function candidateName(candidate: unknown): string | undefined {
  return isRecord(candidate) && typeof candidate.name === 'string' ? candidate.name : undefined
}

/** Case- and whitespace-insensitive key used to detect clashing names. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Hands out names that clash with no existing or earlier name: `name`, then `name (imported)`,
 * `name (imported 2)`… Each base name resumes where it stopped, so n clashes cost O(n).
 */
export class UniqueNames {
  private readonly taken = new Set<string>()
  private readonly next = new Map<string, number>()

  constructor(existing: Iterable<string>) {
    for (const name of existing) this.taken.add(nameKey(name))
  }

  take(name: string): string {
    let candidate = name
    if (this.taken.has(nameKey(candidate))) {
      const base = nameKey(name)
      let n = this.next.get(base) ?? 1
      do {
        candidate = n === 1 ? `${name} (imported)` : `${name} (imported ${n})`
        n++
      } while (this.taken.has(nameKey(candidate)))
      this.next.set(base, n)
    }
    this.taken.add(nameKey(candidate))
    return candidate
  }
}

/**
 * What makes two profiles the same connection (an import skips it as a duplicate): protocol,
 * host (any case), port, the WebSocket path (ws / wss only), user name and client id. With an
 * empty client id (a new random id on every connect) the name stands in for the client id, so
 * two different connections to one broker are not taken for each other.
 */
export function connectionIdentity(profile: ConnectionProfile): string {
  const rawPath = profile.path.trim()
  const path = !isWebSocketProtocol(profile.protocol)
    ? ''
    : rawPath === '' || rawPath.startsWith('/')
      ? rawPath
      : `/${rawPath}`
  const who = profile.clientId === '' ? `name:${nameKey(profile.name)}` : `id:${profile.clientId}`
  return JSON.stringify([
    profile.protocol,
    profile.host.trim().toLowerCase(),
    profile.port,
    path,
    profile.username,
    who
  ])
}

/**
 * True for a TLS file path an import may keep: absolute on a local drive (`C:\…`, `C:/…`) or a
 * POSIX absolute path (`/…`). UNC paths (`\\host\…`, `//host/…`: Windows would contact the host
 * and authenticate with the user's credentials), device paths (`\\?\…`, `\\.\…`) and relative
 * paths are not.
 */
export function isImportableFilePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || /^\/(?![\\/])/.test(path)
}

/**
 * The TLS settings of an imported profile with every path that `isImportableFilePath` refuses
 * cleared; the passphrase goes with a cleared key path (it only unlocks that key). `cleared`
 * tells whether anything was removed (the user must pick those files again).
 */
export function withImportableTlsPaths(tls: TlsSettings): { tls: TlsSettings; cleared: boolean } {
  const next: TlsSettings = { ...tls }
  let cleared = false
  for (const field of ['caPath', 'certPath', 'keyPath'] as const) {
    if (next[field] === '' || isImportableFilePath(next[field])) continue
    next[field] = ''
    cleared = true
    if (field === 'keyPath') next.passphrase = ''
  }
  return { tls: cleared ? next : tls, cleared }
}

export interface BuildExportOptions extends ExportConnectionsOptions {
  /** `exportedAt` of the file. Default: now. */
  now?: Date
}

/**
 * The export file: `{ app, version, exportedAt, connections }`. Passwords and TLS passphrases are
 * left out (empty) unless `includeSecrets`: encryption at rest is machine-bound, so an export
 * could only hold them in plain text. Machine-specific fields (`lastConnectedAt`) are dropped.
 */
export function buildExport(
  profiles: readonly ConnectionProfile[],
  options: BuildExportOptions = {}
): string {
  const includeSecrets = options.includeSecrets === true
  const connections = profiles.map((profile) => {
    const copy = structuredClone(profile)
    delete copy.lastConnectedAt
    if (!includeSecrets) {
      copy.password = ''
      copy.tls.passphrase = ''
    }
    return copy
  })
  const file = {
    app: APP_NAME,
    version: EXPORT_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    connections
  }
  return JSON.stringify(file, null, 2) + '\n'
}
