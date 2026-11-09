/**
 * Renderer startup: loads persisted data, wires IPC events into the stores and restores the
 * live sessions of the main process. Failures never block the UI: they are logged and shown
 * as toasts once the app is mounted, and so are the storage problems the main process found
 * (a locked, damaged or restored file must never look like an empty app).
 */
import { watch, watchEffect } from 'vue'
import type { Router } from 'vue-router'
import { ROUTE_NAMES, routeConnectionId } from '@/composables/useNavigation'
import { applyDocumentTheme } from '@/composables/useThemeSync'
import { forgetLastConnectionId, readLastConnectionId } from '@/router/last-connection'
import { api, errorMessage } from '@/services/api'
import { onConnectionRemoved } from '@/stores/connection-lifecycle'
import { useConnectionsStore } from '@/stores/connections'
import { usePinsStore } from '@/stores/pins'
import { usePublishStore } from '@/stores/publish'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { autoConnect, firstStartOfRun } from './auto-connect'
import { registerIpcListeners } from './ipc-listeners'
import { reportStartupProblem, reportStorageNotice } from './notices'

async function attempt(problem: string, task: () => Promise<unknown> | unknown): Promise<boolean> {
  try {
    await task()
    return true
  } catch (err) {
    console.error(`[mqtt-in] ${problem}:`, err)
    reportStartupProblem(problem, errorMessage(err))
    return false
  }
}

/**
 * Initializes the stores. Call after `app.use(pinia)` and `app.use(router)`, before
 * `app.mount()`:
 * 1. settings (the theme is applied to `<html>` before the first paint),
 * 2. IPC listeners (once, before hydration so no event is missed; later storage notices too),
 * 3. connections + publish drafts / history + pinned values,
 * 4. the storage notices collected by the main process (one warning toast each),
 * 5. live sessions of the main process (survive renderer reloads),
 * 6. connects the "Connect on startup" profiles (once per app run, `./auto-connect`),
 * 7. reopens the last connection when the app starts on the welcome screen.
 */
export async function initApp(router: Router): Promise<void> {
  const settings = useSettingsStore()
  const connections = useConnectionsStore()
  const publish = usePublishStore()
  const pins = usePinsStore()

  await attempt('Could not load the settings', () => settings.load())
  applyDocumentTheme(settings.isDark, settings.settings.accent)

  await attempt('Could not listen to MQTT events', () => registerIpcListeners())

  const [connectionsLoaded] = await Promise.all([
    attempt('Could not load the connections', () => connections.load()),
    attempt('Could not restore the publish drafts', () => publish.load()),
    attempt('Could not restore the pinned values', () => pins.load())
  ])
  // Only prune against a reliable list: a failed load must not wipe every draft.
  if (connectionsLoaded) {
    const ids = new Set(connections.profiles.map((profile) => profile.id))
    publish.prune(ids)
    pins.prune(ids)
  }

  await showStorageNotices()

  await attempt('Could not restore the live sessions', async () => {
    useSessionsStore().hydrate(await api.mqtt.getSessions())
  })

  if (firstStartOfRun() && connectionsLoaded) {
    const sessions = useSessionsStore()
    // Not awaited: the window must not wait for brokers; failures are toasts of their own.
    void autoConnect({
      profiles: connections.profiles,
      isActive: (id) => sessions.isActive(id),
      connect: (id) => sessions.connect(id)
    })
  }

  onConnectionRemoved((id) => forgetLastConnectionId(id))
  leaveRemovedConnections(router)
  syncDocumentTitle(router)
  await restoreLastConnection(router)
}

/**
 * One warning toast per storage problem of this session (later ones arrive through
 * `onStorageNotice`, subscribed before this call; duplicates are dropped).
 */
async function showStorageNotices(): Promise<void> {
  try {
    for (const notice of await api.app.getStorageNotices()) reportStorageNotice(notice, 'warning')
  } catch (err) {
    console.warn('[mqtt-in] could not read the storage notices:', err)
  }
}

/** Navigates home when the open connection is deleted. */
function leaveRemovedConnections(router: Router): void {
  const connections = useConnectionsStore()
  watch(
    () => connections.profiles.map((profile) => profile.id),
    (ids) => {
      const id = routeConnectionId(router.currentRoute.value)
      if (id === null || ids.includes(id)) return
      forgetLastConnectionId(id)
      void router.replace({ name: ROUTE_NAMES.welcome })
    }
  )
}

/** `<connection> — mqtt-in` while a workspace is open. */
function syncDocumentTitle(router: Router): void {
  if (typeof document === 'undefined') return
  const connections = useConnectionsStore()
  watchEffect(() => {
    const route = router.currentRoute.value
    const id = routeConnectionId(route)
    const name =
      id !== null
        ? connections.get(id)?.name
        : route.name === ROUTE_NAMES.settings
          ? 'Settings'
          : undefined
    document.title = name ? `${name} — mqtt-in` : 'mqtt-in'
  })
}

async function restoreLastConnection(router: Router): Promise<void> {
  try {
    await router.isReady()
  } catch {
    return
  }
  if (router.currentRoute.value.name !== ROUTE_NAMES.welcome) return
  const id = readLastConnectionId()
  if (!id) return
  if (!useConnectionsStore().get(id)) {
    forgetLastConnectionId(id)
    return
  }
  try {
    await router.replace({ name: ROUTE_NAMES.connection, params: { id } })
  } catch (err) {
    console.warn('[mqtt-in] could not reopen the last connection:', err)
  }
}
