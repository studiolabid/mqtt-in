/**
 * Typed navigation between the app's screens (welcome, connection workspace, settings).
 */
import { computed, type ComputedRef } from 'vue'
import {
  isNavigationFailure,
  NavigationFailureType,
  useRoute,
  useRouter,
  type RouteLocationNormalizedLoaded,
  type RouteLocationRaw
} from 'vue-router'

/** Route names defined by `@/router`. */
export const ROUTE_NAMES = {
  welcome: 'welcome',
  connection: 'connection',
  settings: 'settings'
} as const

/** The `:id` of a connection route, or null for other routes. */
export function routeConnectionId(
  route: Pick<RouteLocationNormalizedLoaded, 'name' | 'params'>
): string | null {
  if (route.name !== ROUTE_NAMES.connection) return null
  const id = route.params.id
  return (Array.isArray(id) ? id[0] : id) ?? null
}

export interface Navigation {
  /** Id of the connection whose workspace is open, or null. */
  currentConnectionId: ComputedRef<string | null>
  isSettingsOpen: ComputedRef<boolean>
  openConnection(id: string): Promise<void>
  /** Opens the settings, scrolled to `section` (e.g. `messages`) when given. */
  openSettings(section?: string): Promise<void>
  openWelcome(): Promise<void>
}

/** Must be called from a component `setup` (it uses the injected router). */
export function useNavigation(): Navigation {
  const router = useRouter()
  const route = useRoute()

  const currentConnectionId = computed(() => routeConnectionId(route))

  async function go(target: RouteLocationRaw): Promise<void> {
    const failure = await router.push(target)
    if (!failure) return
    const { message } = failure
    // Navigating to the current location is not worth a warning.
    if (isNavigationFailure(failure, NavigationFailureType.duplicated)) return
    console.warn('[mqtt-in] navigation failed:', message)
  }

  return {
    currentConnectionId,
    isSettingsOpen: computed(() => route.name === ROUTE_NAMES.settings),
    openConnection: (id) => go({ name: ROUTE_NAMES.connection, params: { id } }),
    openSettings: (section) =>
      go({ name: ROUTE_NAMES.settings, query: section ? { section } : {} }),
    openWelcome: () => go({ name: ROUTE_NAMES.welcome })
  }
}
