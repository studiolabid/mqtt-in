/**
 * `storage.*` — the small persistent key/value store for UI data.
 */
import { IPC } from '@shared/ipc'
import type { KvRepo } from '../services/storage'
import type { RegisterHandler } from './handle'
import { parseStorageKey } from './validate'

/** Registers `storage.get` / `storage.set`. */
export function registerStorageIpc(register: RegisterHandler, kv: KvRepo): void {
  register(IPC.storageGet, (_ctx, key) => kv.get(parseStorageKey(key)))
  register(IPC.storageSet, (_ctx, key, value) => {
    kv.set(parseStorageKey(key), value)
  })
}
