/**
 * Connects the profiles marked "Connect on startup" (`autoConnect`) once per app run.
 *
 * It runs in the renderer, after the IPC listeners are registered, so no message of the first
 * seconds (retained values) is missed. The window's `sessionStorage` survives renderer reloads but
 * not a restart, so a reload never reconnects a connection the user closed. Connections the main
 * process still has open (a reload) are left alone either way.
 */
import type { ConnectionProfile } from '@shared/models'

export const AUTO_CONNECT_KEY = 'mqtt-in.autoConnectDone'

type RunStorage = Pick<Storage, 'getItem' | 'setItem'>

function sessionStore(): RunStorage | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

/**
 * True the first time it is asked in this app run (and remembers the answer). Without storage
 * every call is the first: the connections still open are skipped by `autoConnect` anyway.
 */
export function firstStartOfRun(storage: RunStorage | null = sessionStore()): boolean {
  if (!storage) return true
  try {
    if (storage.getItem(AUTO_CONNECT_KEY) !== null) return false
    storage.setItem(AUTO_CONNECT_KEY, '1')
    return true
  } catch {
    return true
  }
}

export interface AutoConnectDeps {
  profiles: readonly ConnectionProfile[]
  /** The connection is connecting or connected already. */
  isActive: (connectionId: string) => boolean
  connect: (connectionId: string) => Promise<unknown>
}

/** Connects every `autoConnect` profile that is not active yet; resolves with their ids. */
export async function autoConnect(deps: AutoConnectDeps): Promise<string[]> {
  const ids = deps.profiles
    .filter((profile) => profile.autoConnect === true && !deps.isActive(profile.id))
    .map((profile) => profile.id)
  await Promise.all(ids.map((id) => deps.connect(id)))
  return ids
}
