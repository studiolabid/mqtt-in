/**
 * Route table: `/` welcome, `/connections/:id` workspace, `/settings`.
 *
 * Only the welcome screen is part of the startup bundle. The workspace (with CodeMirror, uPlot
 * and every feature panel) and the settings page are separate chunks loaded on first use; the
 * workspace chunk is prefetched once the renderer is idle (`prefetchWorkspace`).
 */
import type { RouteRecordRaw } from 'vue-router'
import { ROUTE_NAMES } from '@/composables/useNavigation'
import WelcomeView from '@/features/shell/WelcomeView.vue'

export const routes: RouteRecordRaw[] = [
  { path: '/', name: ROUTE_NAMES.welcome, component: WelcomeView },
  {
    path: '/connections/:id',
    name: ROUTE_NAMES.connection,
    component: () => import('@/features/workspace/ConnectionWorkspace.vue'),
    props: true
  },
  {
    path: '/settings',
    name: ROUTE_NAMES.settings,
    component: () => import('@/features/settings/SettingsView.vue')
  },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

/**
 * Starts loading the workspace chunk when the renderer is idle, so the first click on a
 * connection does not wait for it. Best effort: a failure surfaces on navigation instead.
 */
export function prefetchWorkspace(): void {
  const load = (): void => {
    import('@/features/workspace/ConnectionWorkspace.vue').catch((err: unknown) => {
      console.warn('[mqtey] could not prefetch the workspace:', err)
    })
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(load, { timeout: 3000 })
  else setTimeout(load, 1000)
}
