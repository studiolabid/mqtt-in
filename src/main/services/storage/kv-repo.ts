/**
 * Small persistent key/value store for renderer UI data (`storage.json`):
 * publish history, layout sizes, recent topics…
 */
import { errorMessage, isRecord } from '../../utils/errors'
import type { JsonFile } from './json-file'

/** Largest accepted value, measured as UTF-8 JSON. */
export const MAX_KV_VALUE_BYTES = 2 * 1024 * 1024

export type KvData = Record<string, unknown>

function parseKvFile(raw: unknown): KvData {
  if (!isRecord(raw) || Array.isArray(raw)) throw new Error('expected a JSON object')
  return raw
}

export class KvRepo {
  /** A Map (not an object) so keys like `__proto__` are plain data. */
  private readonly entries: Map<string, unknown>

  constructor(private readonly file: JsonFile<KvData>) {
    this.entries = new Map(Object.entries(file.load({}, parseKvFile)))
  }

  get(key: string): unknown {
    return this.entries.get(key)
  }

  /**
   * Stores a JSON-serializable value (`undefined` deletes the key). The stored value is
   * the JSON round-trip of `value`, i.e. exactly what will be read back after a restart.
   * Throws when the value cannot be serialized or exceeds 2 MB.
   */
  set(key: string, value: unknown): void {
    let json: string | undefined
    try {
      json = value === undefined ? undefined : JSON.stringify(value)
    } catch (err) {
      throw new Error(`Value for "${key}" is not JSON serializable: ${errorMessage(err)}`, {
        cause: err
      })
    }
    if (json === undefined) {
      if (!this.entries.delete(key)) return
    } else {
      if (Buffer.byteLength(json, 'utf8') > MAX_KV_VALUE_BYTES) {
        throw new Error(`Value for "${key}" is too large (max 2 MB)`)
      }
      this.entries.set(key, JSON.parse(json))
    }
    this.file.set(Object.fromEntries(this.entries))
  }
}
