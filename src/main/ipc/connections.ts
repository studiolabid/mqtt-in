/**
 * `connections.*` — persisted profiles, import / export files.
 *
 * Export writes passwords and TLS passphrases only with `{ includeSecrets: true }`; the written
 * file joins the known files (`app.showItemInFolder` may reveal it). Import returns an
 * `ImportConnectionsResult` (imported, skipped with reasons, duplicates of saved connections,
 * cleared TLS paths, the recognized format) and rejects only an unrecognized file or one that
 * holds no valid entry and no duplicate.
 */
import { writeFile } from 'node:fs/promises'
import { IPC } from '@shared/ipc'
import type { ImportConnectionsResult } from '@shared/models'
import { knownFiles } from '../services/known-files'
import type { MqttManager } from '../services/mqtt/mqtt-manager'
import type { ConnectionsRepo, ImportResult } from '../services/storage'
import {
  MAX_LISTED_SKIPS,
  toImportConnectionsResult
} from '../services/storage/connections-transfer'
import { errorMessage } from '../utils/errors'
import { stripBom } from '../utils/text'
import { chooseOpenPath, chooseSavePath, readFileWithLimit } from './file-dialogs'
import type { RegisterHandler } from './handle'
import {
  parseConnectionProfile,
  parseExportOptions,
  parseId,
  parseIds,
  parseOptionalIds
} from './validate'

const FILTERS = [{ name: 'mqtey connections', extensions: ['json'] }]
const DEFAULT_EXPORT_NAME = 'mqtey-connections.json'
const MAX_IMPORT_BYTES = 16 * 1024 * 1024

/** Logs why entries were skipped (the first `MAX_LISTED_SKIPS`, then a count). */
function logSkipped(result: ImportResult): void {
  for (const skip of result.skipped.slice(0, MAX_LISTED_SKIPS)) {
    console.warn(`[import] Skipped ${skip.name ?? `entry ${skip.index + 1}`}: ${skip.reason}`)
  }
  const more = result.skipped.length - MAX_LISTED_SKIPS
  if (more > 0) console.warn(`[import] … and ${more} more skipped entries`)
}

/** Registers `connections.*`; removing a profile also drops its live session. */
export function registerConnectionsIpc(
  register: RegisterHandler,
  repo: ConnectionsRepo,
  manager: MqttManager
): void {
  register(IPC.connectionsList, () => repo.list())

  register(IPC.connectionsSave, (_ctx, profile) => repo.save(parseConnectionProfile(profile)))

  register(IPC.connectionsRemove, async (_ctx, rawId) => {
    const id = parseId(rawId, 'connection id')
    await manager.forget(id)
    repo.remove(id)
  })

  register(IPC.connectionsReorder, (_ctx, ids) => {
    repo.reorder(parseIds(ids))
  })

  register(IPC.connectionsImport, async ({ window }): Promise<ImportConnectionsResult | null> => {
    const path = await chooseOpenPath(window, { title: 'Import connections', filters: FILTERS })
    if (!path) return null
    const text = (await readFileWithLimit(path, MAX_IMPORT_BYTES)).toString('utf8')
    let data: unknown
    try {
      data = JSON.parse(stripBom(text))
    } catch (err) {
      throw new Error(`The file is not valid JSON: ${errorMessage(err)}`, { cause: err })
    }
    const result = repo.importProfiles(data)
    logSkipped(result)
    // Nothing new and nothing already present: the file is of no use, say why.
    if (result.imported.length === 0 && result.duplicates === 0) {
      const first = result.skipped[0]
      throw new Error(
        first
          ? `No valid connections in the file (${first.name ?? `entry ${first.index + 1}`}: ${first.reason})`
          : 'No connections found in the file'
      )
    }
    return toImportConnectionsResult(result)
  })

  register(
    IPC.connectionsExport,
    async ({ window }, rawIds, rawOptions): Promise<string | null> => {
      const ids = parseOptionalIds(rawIds)
      const options = parseExportOptions(rawOptions)
      const selected = ids ? repo.list().filter((p) => ids.includes(p.id)) : repo.list()
      if (selected.length === 0) throw new Error('There are no connections to export')
      const path = await chooseSavePath(window, {
        title: 'Export connections',
        defaultPath: DEFAULT_EXPORT_NAME,
        filters: FILTERS
      })
      if (!path) return null
      await writeFile(path, repo.exportProfiles(ids, options), 'utf8')
      knownFiles.remember(path)
      return path
    }
  )
}
