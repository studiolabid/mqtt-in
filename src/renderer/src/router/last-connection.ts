/**
 * Remembers the last opened connection (localStorage `mqtey.lastConnectionId`).
 * Storage may be unavailable (private mode, blocked): every access is best effort.
 */

export const LAST_CONNECTION_KEY = 'mqtey.lastConnectionId'

export function readLastConnectionId(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_CONNECTION_KEY) ?? null
  } catch {
    return null
  }
}

export function rememberLastConnectionId(id: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_CONNECTION_KEY, id)
  } catch {
    // Storage unavailable: nothing to remember.
  }
}

/** Forgets the remembered id (only when it equals `id`, if given). */
export function forgetLastConnectionId(id?: string): void {
  try {
    const storage = globalThis.localStorage
    if (!storage) return
    if (id === undefined || storage.getItem(LAST_CONNECTION_KEY) === id) {
      storage.removeItem(LAST_CONNECTION_KEY)
    }
  } catch {
    // Storage unavailable: nothing to forget.
  }
}
