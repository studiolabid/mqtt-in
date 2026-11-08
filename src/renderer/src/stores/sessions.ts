/**
 * Live session status per connection (fed by `onStatus` events from the main process), with
 * what the broker announced in its CONNACK (`brokerInfo`) and the last measured round trip
 * (`rttMs`) while connected.
 */
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { BrokerInfo, ConnectionStatus, SessionSnapshot, StatusEvent } from '@shared/models'
import { api, errorMessage } from '@/services/api'
import type { SessionView } from '@/types'
import { isActiveStatus, isBusyStatus } from '@/utils/connection'
import { onConnectionRemoved } from './connection-lifecycle'
import { useConnectionsStore } from './connections'
import { usePublishStore } from './publish'
import { useSubscriptionsStore } from './subscriptions'

export const useSessionsStore = defineStore('sessions', () => {
  /** Known sessions by connection id (missing = disconnected). */
  const sessions = ref<Record<string, SessionView>>({})
  onScopeDispose(onConnectionRemoved(forget))

  /** Ids of the connected sessions. */
  const connectedIds = computed(() =>
    Object.values(sessions.value)
      .filter((session) => session.status === 'connected')
      .map((session) => session.connectionId)
  )

  /** Session view of a connection (`disconnected` when unknown). */
  function get(connectionId: string): SessionView {
    return sessions.value[connectionId] ?? { connectionId, status: 'disconnected', updatedAt: 0 }
  }

  function statusOf(connectionId: string): ConnectionStatus {
    return sessions.value[connectionId]?.status ?? 'disconnected'
  }

  function isConnected(connectionId: string): boolean {
    return statusOf(connectionId) === 'connected'
  }

  /** connecting | disconnecting | reconnecting */
  function isBusy(connectionId: string): boolean {
    return isBusyStatus(statusOf(connectionId))
  }

  /** connected | connecting | reconnecting (what `toggle` disconnects). */
  function isActive(connectionId: string): boolean {
    return isActiveStatus(statusOf(connectionId))
  }

  /**
   * What the broker announced in its last CONNACK, while connected (CT-16). `undefined` when
   * not connected, or before the main process reported it.
   */
  function brokerInfo(connectionId: string): BrokerInfo | undefined {
    const session = sessions.value[connectionId]
    return session?.status === 'connected' ? session.broker : undefined
  }

  /** Last measured round trip in ms, while connected (CT-16); `undefined` until measured. */
  function rttMs(connectionId: string): number | undefined {
    const session = sessions.value[connectionId]
    return session?.status === 'connected' ? session.rttMs : undefined
  }

  /**
   * Connects the saved profile (optimistic `connecting`). Failures to start show a toast;
   * later failures arrive as status events.
   *
   * @returns whether the attempt started.
   */
  async function connect(connectionId: string): Promise<boolean> {
    const profile = useConnectionsStore().get(connectionId)
    if (!profile) {
      toast.error('Connection not found')
      return false
    }
    const status = statusOf(connectionId)
    if (status === 'disconnecting') return false
    if (isActiveStatus(status)) return true
    setStatus(connectionId, 'connecting')
    try {
      await api.mqtt.connect(connectionId)
      return true
    } catch (err) {
      const message = errorMessage(err)
      setStatus(connectionId, 'error', message)
      toast.error(`Could not connect to ${profile.name}`, { description: message })
      return false
    }
  }

  /**
   * Gracefully disconnects (also cancels auto-reconnect and repeat jobs in the main process).
   *
   * @returns false (after a toast) when the main process refused.
   */
  async function disconnect(connectionId: string): Promise<boolean> {
    const previous = sessions.value[connectionId]
    if (!previous || previous.status === 'disconnected') return true
    setStatus(connectionId, 'disconnecting')
    try {
      await api.mqtt.disconnect(connectionId)
      // The main process normally reports `disconnected` itself; never stay stuck.
      if (statusOf(connectionId) === 'disconnecting') setStatus(connectionId, 'disconnected')
      return true
    } catch (err) {
      if (statusOf(connectionId) === 'disconnecting') sessions.value[connectionId] = previous
      const name = useConnectionsStore().get(connectionId)?.name ?? 'the connection'
      toast.error(`Could not disconnect ${name}`, { description: errorMessage(err) })
      return false
    }
  }

  /**
   * Connects with the saved settings, replacing a live session (`connect` keeps an active one
   * as it is): disconnects first when active.
   *
   * @returns whether the new attempt started.
   */
  async function reconnect(connectionId: string): Promise<boolean> {
    if (isActive(connectionId) && !(await disconnect(connectionId))) return false
    return connect(connectionId)
  }

  /** Disconnects an active session, connects an inactive one (ignored while disconnecting). */
  function toggle(connectionId: string): Promise<boolean> {
    const status = statusOf(connectionId)
    if (status === 'disconnecting') return Promise.resolve(false)
    return isActiveStatus(status) ? disconnect(connectionId) : connect(connectionId)
  }

  /**
   * Applies a status event from the main process. A `connected` event while already connected
   * only refreshes what it carries (e.g. a new `rttMs`): the connect time and the broker facts
   * of the CONNACK are kept. Leaving `connected` drops the broker facts and the round trip.
   */
  function handleStatus(event: StatusEvent): void {
    const id = event.connectionId
    const previous = sessions.value[id]
    const connected = event.status === 'connected'
    const stillConnected = connected && previous?.status === 'connected'
    const view: SessionView = {
      connectionId: id,
      status: event.status,
      error: event.error,
      clientId: event.clientId ?? previous?.clientId,
      connectedAt: connected
        ? (event.connectedAt ??
          (stillConnected ? previous?.connectedAt : undefined) ??
          event.timestamp)
        : undefined,
      updatedAt: event.timestamp
    }
    if (connected) {
      const broker = event.broker ?? (stillConnected ? previous?.broker : undefined)
      const rtt = event.rttMs ?? (stillConnected ? previous?.rttMs : undefined)
      if (broker) view.broker = broker
      if (rtt !== undefined) view.rttMs = rtt
    }
    sessions.value[id] = view

    const subscriptions = useSubscriptionsStore()
    if (previous?.status === 'connected' && !connected) subscriptions.resetStates(id)
    if (connected && previous?.status !== 'connected') {
      useConnectionsStore().touchLastConnected(id, event.connectedAt ?? event.timestamp)
      subscriptions.onConnected(id)
    }
    if (event.status === 'error' && previous?.status !== 'error') {
      const name = useConnectionsStore().get(id)?.name ?? 'Connection'
      toast.error(`${name}: connection failed`, { description: event.error })
    }
  }

  /** Restores sessions (and their subscription / repeat job states) after a renderer reload. */
  function hydrate(snapshots: readonly SessionSnapshot[]): void {
    const subscriptions = useSubscriptionsStore()
    const publish = usePublishStore()
    for (const snapshot of snapshots) {
      const connected = snapshot.status === 'connected'
      const view: SessionView = {
        connectionId: snapshot.connectionId,
        status: snapshot.status,
        error: snapshot.error,
        clientId: snapshot.clientId,
        connectedAt: connected ? snapshot.connectedAt : undefined,
        updatedAt: Date.now()
      }
      if (connected && snapshot.broker) view.broker = snapshot.broker
      if (connected && snapshot.rttMs !== undefined) view.rttMs = snapshot.rttMs
      sessions.value[snapshot.connectionId] = view
      subscriptions.hydrate(snapshot.connectionId, snapshot.subscriptions)
      for (const job of snapshot.repeatJobs) publish.handleRepeat(job)
    }
  }

  /** Drops the session of a deleted connection (registered with `onConnectionRemoved`). */
  function forget(connectionId: string): void {
    delete sessions.value[connectionId]
  }

  /** Optimistic local status (never `connected`, so the broker facts are dropped). */
  function setStatus(connectionId: string, status: ConnectionStatus, error?: string): void {
    const previous = sessions.value[connectionId]
    sessions.value[connectionId] = {
      connectionId,
      status,
      error,
      clientId: previous?.clientId,
      connectedAt: status === 'connected' ? previous?.connectedAt : undefined,
      updatedAt: Date.now()
    }
  }

  return {
    sessions,
    connectedIds,
    get,
    statusOf,
    isConnected,
    isBusy,
    isActive,
    brokerInfo,
    rttMs,
    connect,
    disconnect,
    reconnect,
    toggle,
    handleStatus,
    hydrate,
    forget
  }
})
