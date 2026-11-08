/**
 * The import pipeline of `ConnectionsRepo.importProfiles`. Each entry of the file is:
 * 1. mapped when it comes from MQTTX (`fromMqttx`);
 * 2. validated as strictly as a save (`safeParseConnectionProfile(…, 'strict')`); an entry without
 *    a host is no connection;
 * 3. skipped when the same connection is saved already, or came earlier in the file
 *    (`connectionIdentity`): importing a file twice adds nothing;
 * 4. cleaned of TLS file paths an import must not keep (`withImportableTlsPaths`);
 * 5. renamed when its name is taken (`UniqueNames`) and given a fresh identity (new ids, and a
 *    new client id when mqtey generated the old one: two copies with one id take the broker
 *    session from each other).
 * Pure: nothing is saved here, and no path of the file is touched.
 */
import { withFreshIdentity } from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import { safeParseConnectionProfile } from '../../schemas/profile'
import { isRecord } from '../../utils/errors'
import {
  candidateName,
  connectionIdentity,
  type ImportResult,
  readImportFile,
  UniqueNames,
  withImportableTlsPaths
} from './connections-transfer'
import { fromMqttx, isMqttxEntry } from './import-mqttx'

export interface ImportContext {
  /** The saved profiles: imported names must not clash with theirs, duplicates are skipped. */
  existing: readonly ConnectionProfile[]
  /** Decrypts the `enc:v1:` secrets of a raw entry (a `connections.json` of this machine). */
  openSecrets: (entry: unknown) => unknown
  /** `createdAt` / `updatedAt` of the imported profiles. */
  now: number
}

const FALLBACK_NAME = 'Imported connection'

/**
 * The profiles to add for the parsed JSON of an import file, and what was skipped. Throws a
 * human error for an unrecognized file or one with more than `MAX_IMPORT_ENTRIES` entries.
 */
export function planImport(data: unknown, context: ImportContext): ImportResult {
  const { candidates, source } = readImportFile(data)
  const names = new UniqueNames(context.existing.map((profile) => profile.name))
  const known = new Set(context.existing.map(connectionIdentity))
  const result: ImportResult = {
    imported: [],
    skipped: [],
    duplicates: 0,
    tlsPathsCleared: 0,
    source
  }

  candidates.forEach((candidate, index) => {
    const entry = isRecord(candidate) && isMqttxEntry(candidate) ? fromMqttx(candidate) : candidate
    const skip = (reason: string): void => {
      result.skipped.push({ index, name: candidateName(candidate), reason })
    }
    const parsed = safeParseConnectionProfile(context.openSecrets(entry), 'strict')
    if (!parsed.ok) return skip(parsed.error)
    if (!isRecord(entry) || typeof entry.host !== 'string') return skip('host: Host is required')

    const identity = connectionIdentity(parsed.value)
    if (known.has(identity)) {
      result.duplicates++
      return
    }
    known.add(identity)

    const { tls, cleared } = withImportableTlsPaths(parsed.value.tls)
    if (cleared) result.tlsPathsCleared++
    const name = names.take(parsed.value.name.trim() || parsed.value.host || FALLBACK_NAME)
    result.imported.push(withFreshIdentity({ ...parsed.value, tls }, { name, now: context.now }))
  })
  return result
}
