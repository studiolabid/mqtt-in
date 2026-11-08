/**
 * Store test setup: a fresh Pinia and fake bridge per test, optionally seeded with profiles.
 * Test files must mock `vue-sonner` themselves (`vi.mock` is hoisted per file).
 *
 * The stores of the previous test's Pinia are disposed first: stores register cleanups in the
 * connection lifecycle registry (`onConnectionRemoved`) and listeners, and disposing their
 * scopes removes them, so registrations do not pile up across tests.
 */
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ConnectionProfile } from '@shared/models'
import { createConnectionProfile } from '@shared/defaults'
import { useConnectionsStore } from '@/stores/connections'
import { useLogsStore } from '@/stores/logs'
import { useMessagesStore } from '@/stores/messages'
import { usePinsStore } from '@/stores/pins'
import { usePublishStore } from '@/stores/publish'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { useUiStore } from '@/stores/ui'
import { installFakeBridge, type FakeBridge } from '../helpers'

export interface StoreSetup {
  bridge: FakeBridge
  profiles: ConnectionProfile[]
}

const STORES = [
  usePinsStore,
  useUiStore,
  useSubscriptionsStore,
  useSessionsStore,
  usePublishStore,
  useLogsStore,
  useMessagesStore,
  useConnectionsStore,
  useSettingsStore
] as const

let previous: Pinia | undefined

/** Disposes every store of the Pinia of the previous `setupStores` call. */
export function disposeStores(): void {
  const pinia = previous
  previous = undefined
  if (!pinia) return
  setActivePinia(pinia)
  for (const use of STORES) use(pinia).$dispose()
}

/** Installs the bridge, activates a new Pinia and loads the given profiles. */
export async function setupStores(
  profiles: Array<Partial<ConnectionProfile>> = []
): Promise<StoreSetup> {
  disposeStores()
  const bridge = installFakeBridge()
  const pinia = createPinia()
  previous = pinia
  setActivePinia(pinia)
  const created = profiles.map((overrides) => createConnectionProfile(overrides))
  bridge.stored.push(...structuredClone(created))
  await useConnectionsStore().load()
  return { bridge, profiles: created }
}
