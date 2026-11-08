/**
 * Pinia stores (state + use cases). See ARCHITECTURE §4.2.
 *
 * Per-connection state is pruned through one registry: `onConnectionRemoved(cleanup)` returns
 * an unregister function, and `useConnectionsStore().remove(id)` calls
 * `notifyConnectionRemoved(id)` once the main process confirmed the delete (CT-11).
 */
export { useSettingsStore } from './settings'
export { useConnectionsStore } from './connections'
export { useSessionsStore } from './sessions'
export { useSubscriptionsStore } from './subscriptions'
export { useMessagesStore, type IngestListener } from './messages'
export { usePublishStore, MAX_PUBLISH_HISTORY, type PublishOptions } from './publish'
export { useLogsStore, MAX_LOG_ENTRIES } from './logs'
export { useUiStore, type ConfirmState } from './ui'
export {
  usePinsStore,
  MAX_PINS_PER_CONNECTION,
  PIN_SERIES_POINTS,
  type PinLatest,
  type PinSeries,
  type TopicPin
} from './pins'
export {
  onConnectionRemoved,
  notifyConnectionRemoved,
  type ConnectionCleanup
} from './connection-lifecycle'
