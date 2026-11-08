/**
 * Hash router: `/` welcome, `/connections/:id` workspace, `/settings` (see `./routes`; the
 * workspace and settings are lazily loaded chunks).
 */
import { createRouter, createWebHashHistory, type Router } from 'vue-router'
import { routeConnectionId, ROUTE_NAMES } from '@/composables/useNavigation'
import { useConnectionsStore } from '@/stores/connections'
import { useUiStore } from '@/stores/ui'
import { forgetLastConnectionId, rememberLastConnectionId } from './last-connection'
import { routes } from './routes'

export { ROUTE_NAMES, routeConnectionId } from '@/composables/useNavigation'
export { prefetchWorkspace, routes } from './routes'

/**
 * Creates the app router. Opening an unknown connection redirects to `/` (the guard waits for
 * the profiles to be loaded); opened connections are remembered for the next start, and the
 * shown connection is reported to the ui store (its unread count stays 0 while shown).
 */
export function createAppRouter(): Router {
  const router = createRouter({ history: createWebHashHistory(), routes })

  router.beforeEach(async (to) => {
    const id = routeConnectionId(to)
    if (id === null) return true
    const connections = useConnectionsStore()
    await connections.whenLoaded()
    if (connections.get(id)) return true
    forgetLastConnectionId(id)
    return { name: ROUTE_NAMES.welcome, replace: true }
  })

  router.afterEach((to, _from, failure) => {
    if (failure) return
    const id = routeConnectionId(to)
    if (id !== null) rememberLastConnectionId(id)
    useUiStore().setShownConnection(id)
  })

  return router
}

export const router = createAppRouter()
