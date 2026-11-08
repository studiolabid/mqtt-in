/**
 * Routes main-process events into the stores (and storage problems into toasts). Registered
 * exactly once per renderer lifetime.
 */
import type { Unsubscribe } from '@shared/ipc'
import { api } from '@/services/api'
import { useLogsStore } from '@/stores/logs'
import { useMessagesStore } from '@/stores/messages'
import { usePublishStore } from '@/stores/publish'
import { useSessionsStore } from '@/stores/sessions'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { reportStorageNotice } from './notices'

let registered: Unsubscribe[] | null = null

/** A throwing handler must never break the stream of later events. */
function guard<T>(name: string, handler: (payload: T) => void): (payload: T) => void {
  return (payload) => {
    try {
      handler(payload)
    } catch (err) {
      console.error(`[mqtey] ${name} handler failed:`, err)
    }
  }
}

/**
 * Subscribes the stores to `onStatus`, `onMessages`, `onSubscription`, `onLog` and `onRepeat`,
 * and shows later storage problems (`app.onStorageNotice`, e.g. a failed write) as error
 * toasts. Calling it again is a no-op. Requires an active Pinia.
 *
 * @returns a function that removes every listener.
 */
export function registerIpcListeners(): () => void {
  if (!registered) {
    const sessions = useSessionsStore()
    const messages = useMessagesStore()
    const subscriptions = useSubscriptionsStore()
    const logs = useLogsStore()
    const publish = usePublishStore()
    const { mqtt, app } = api
    registered = [
      mqtt.onStatus(guard('status', (event) => sessions.handleStatus(event))),
      mqtt.onMessages(guard('messages', (batch) => messages.ingest(batch))),
      mqtt.onSubscription(guard('subscription', (event) => subscriptions.handleEvent(event))),
      mqtt.onLog(guard('log', (entry) => logs.handle(entry))),
      mqtt.onRepeat(guard('repeat', (event) => publish.handleRepeat(event))),
      app.onStorageNotice(guard('storage notice', (notice) => reportStorageNotice(notice, 'error')))
    ]
    if (import.meta.hot) import.meta.hot.dispose(unregisterIpcListeners)
  }
  return unregisterIpcListeners
}

/** Removes the listeners registered by `registerIpcListeners`. */
export function unregisterIpcListeners(): void {
  if (!registered) return
  for (const unsubscribe of registered) unsubscribe()
  registered = null
}
