/**
 * UI state shared across features: dialogs, command palette, per-connection workspace state
 * (tab, selection, message filter, view format, focus and export requests), unread message
 * counts and the confirm dialog. Per-connection state is pruned through `onConnectionRemoved`.
 */
import { defineStore } from 'pinia'
import { onScopeDispose, reactive, ref, toRaw } from 'vue'
import { toast } from 'vue-sonner'
import { isMqttProfile } from '@shared/connection-kind'
import type { ConnectionProfile, Subscription, ViewFormat } from '@shared/models'
import {
  DEFAULT_MESSAGE_FILTER,
  type ConfirmOptions,
  type ConnectionDialogState,
  type MessageExportFormat,
  type MessageExportRequest,
  type MessageFilter,
  type SubscriptionDialogState,
  type WorkspaceTab
} from '@/types'
import { onConnectionRemoved } from './connection-lifecycle'
import { useConnectionsStore } from './connections'
import { useMessagesStore } from './messages'
import { useSettingsStore } from './settings'
import { createUnreadCounts } from './unread'

/** Backing state of the global `ConfirmDialog`. */
export interface ConfirmState {
  open: boolean
  /** Kept after closing so the dialog does not go blank during its exit animation. */
  options: ConfirmOptions | null
  resolve: ((result: boolean) => void) | null
}

export const useUiStore = defineStore('ui', () => {
  const settings = useSettingsStore()

  const connectionDialog = reactive<ConnectionDialogState>({
    open: false,
    editingId: null,
    preset: null
  })
  const subscriptionDialog = reactive<SubscriptionDialogState>({
    open: false,
    connectionId: null,
    editingId: null,
    preset: null,
    multiple: false
  })
  const commandPaletteOpen = ref(false)
  const confirmState = reactive<ConfirmState>({ open: false, options: null, resolve: null })

  const tabs = reactive<Record<string, WorkspaceTab>>({})
  const selectedMessages = reactive<Record<string, number>>({})
  const selectedTopics = reactive<Record<string, string>>({})
  const filters = reactive<Record<string, MessageFilter>>({})
  const formats = reactive<Record<string, ViewFormat>>({})
  const publishFocusRequests = reactive<Record<string, number>>({})
  const exportRequests = reactive<Record<string, MessageExportRequest>>({})
  const unread = createUnreadCounts(useMessagesStore())
  onScopeDispose(onConnectionRemoved(forgetConnection))

  // --- Dialogs ---------------------------------------------------------------

  /** Opens the connection dialog for a new profile (optionally prefilled). */
  function openNewConnection(preset?: Partial<ConnectionProfile>): void {
    Object.assign(connectionDialog, { open: true, editingId: null, preset: preset ?? null })
  }

  /** Opens the connection dialog to edit a saved profile. */
  function openEditConnection(id: string): void {
    Object.assign(connectionDialog, { open: true, editingId: id, preset: null })
  }

  function closeConnectionDialog(): void {
    connectionDialog.open = false
  }

  /**
   * Opens the subscription dialog to add a subscription (optionally prefilled), or several at
   * once with `{ multiple: true }` (one filter per line). WebSocket and Socket.IO connections
   * have no subscriptions: a note says so instead.
   */
  function openNewSubscription(
    connectionId: string,
    preset?: Partial<Subscription>,
    options: { multiple?: boolean } = {}
  ): void {
    const profile = useConnectionsStore().get(connectionId)
    if (profile && !isMqttProfile(profile)) {
      toast.info('Subscriptions are only for MQTT connections', {
        description: 'This connection receives everything the server sends.'
      })
      return
    }
    Object.assign(subscriptionDialog, {
      open: true,
      connectionId,
      editingId: null,
      preset: preset ?? null,
      multiple: options.multiple === true
    })
  }

  /** Opens the subscription dialog to edit a subscription. */
  function openEditSubscription(connectionId: string, subscriptionId: string): void {
    Object.assign(subscriptionDialog, {
      open: true,
      connectionId,
      editingId: subscriptionId,
      preset: null,
      multiple: false
    })
  }

  function closeSubscriptionDialog(): void {
    subscriptionDialog.open = false
  }

  // --- Confirm ---------------------------------------------------------------

  /**
   * Shows the confirm dialog. A confirm that is still open resolves `false` first.
   *
   * @returns true when the user confirmed.
   */
  function confirm(options: ConfirmOptions): Promise<boolean> {
    confirmState.resolve?.(false)
    return new Promise<boolean>((resolve) => {
      confirmState.options = { ...options }
      confirmState.resolve = resolve
      confirmState.open = true
    })
  }

  /** Called by `ConfirmDialog` when the user answers (or dismisses: `false`). */
  function resolveConfirm(result: boolean): void {
    const resolve = confirmState.resolve
    confirmState.resolve = null
    confirmState.open = false
    resolve?.(result)
  }

  /** Destructive confirm that is skipped (resolves true) when `confirmBeforeDelete` is off. */
  function confirmDestructive(options: ConfirmOptions): Promise<boolean> {
    if (!settings.settings.confirmBeforeDelete) return Promise.resolve(true)
    return confirm({ confirmText: 'Delete', ...options, destructive: true })
  }

  // --- Workspace state (per connection) -------------------------------------

  function workspaceTab(connectionId: string): WorkspaceTab {
    return tabs[connectionId] ?? 'messages'
  }

  function setWorkspaceTab(connectionId: string, tab: WorkspaceTab): void {
    tabs[connectionId] = tab
  }

  function selectedMessageId(connectionId: string): number | null {
    return selectedMessages[connectionId] ?? null
  }

  function selectMessage(connectionId: string, id: number | null): void {
    if (id === null) delete selectedMessages[connectionId]
    else selectedMessages[connectionId] = id
  }

  function selectedTopic(connectionId: string): string | null {
    return selectedTopics[connectionId] ?? null
  }

  function selectTopic(connectionId: string, topic: string | null): void {
    if (topic === null) delete selectedTopics[connectionId]
    else selectedTopics[connectionId] = topic
  }

  /** The reactive message filter of a connection (bind inputs to its fields directly). */
  function messageFilter(connectionId: string): MessageFilter {
    // Check through the raw object: creating the filter must not re-trigger a running computed.
    if (!(connectionId in toRaw(filters))) filters[connectionId] = { ...DEFAULT_MESSAGE_FILTER }
    return filters[connectionId]
  }

  function updateMessageFilter(connectionId: string, patch: Partial<MessageFilter>): void {
    Object.assign(messageFilter(connectionId), patch)
  }

  function resetMessageFilter(connectionId: string): void {
    filters[connectionId] = { ...DEFAULT_MESSAGE_FILTER }
  }

  /** Clears a subscription filter that points at a removed subscription. */
  function dropSubscriptionReferences(connectionId: string, subscriptionId: string): void {
    const filter = toRaw(filters)[connectionId]
    if (filter?.subscriptionId === subscriptionId) filters[connectionId].subscriptionId = null
  }

  /** Payload view format of a connection (defaults to `settings.defaultViewFormat`). */
  function viewFormat(connectionId: string): ViewFormat {
    return formats[connectionId] ?? settings.settings.defaultViewFormat
  }

  function setViewFormat(connectionId: string, format: ViewFormat): void {
    formats[connectionId] = format
  }

  /** Shows the message list filtered by `patch` (e.g. "click a subscription to filter"). */
  function showMessages(connectionId: string, patch: Partial<MessageFilter> = {}): void {
    updateMessageFilter(connectionId, patch)
    setWorkspaceTab(connectionId, 'messages')
  }

  /**
   * Counter that bumps every time something asks to focus the publisher of a connection
   * (e.g. "Edit & publish" from a message). The workspace expands a collapsed publish panel and
   * the publish panel focuses its payload editor when it changes.
   */
  function publishFocusRequest(connectionId: string): number {
    return publishFocusRequests[connectionId] ?? 0
  }

  function requestPublishFocus(connectionId: string): void {
    publishFocusRequests[connectionId] = publishFocusRequest(connectionId) + 1
  }

  /**
   * Asks the messages feature to export the connection's (filtered) messages, e.g. from the
   * command palette (CT-17). The messages panel watches `messageExportRequest`.
   */
  function requestMessageExport(connectionId: string, format: MessageExportFormat): void {
    const seq = (exportRequests[connectionId]?.seq ?? 0) + 1
    exportRequests[connectionId] = { seq, format }
  }

  /** The latest export request of a connection (`seq` bumps with every request), or null. */
  function messageExportRequest(connectionId: string): MessageExportRequest | null {
    return exportRequests[connectionId] ?? null
  }

  /** Opens a topic in the topic explorer. */
  function showTopic(connectionId: string, topic: string): void {
    selectTopic(connectionId, topic)
    setWorkspaceTab(connectionId, 'topics')
  }

  /**
   * Drops every piece of UI state of a deleted connection (registered with
   * `onConnectionRemoved`).
   */
  function forgetConnection(connectionId: string): void {
    delete tabs[connectionId]
    delete selectedMessages[connectionId]
    delete selectedTopics[connectionId]
    delete filters[connectionId]
    delete formats[connectionId]
    delete publishFocusRequests[connectionId]
    delete exportRequests[connectionId]
    unread.forget(connectionId)
    if (connectionDialog.editingId === connectionId) closeConnectionDialog()
    if (subscriptionDialog.connectionId === connectionId) closeSubscriptionDialog()
  }

  return {
    connectionDialog,
    subscriptionDialog,
    commandPaletteOpen,
    confirmState,
    openNewConnection,
    openEditConnection,
    closeConnectionDialog,
    openNewSubscription,
    openEditSubscription,
    closeSubscriptionDialog,
    confirm,
    resolveConfirm,
    confirmDestructive,
    workspaceTab,
    setWorkspaceTab,
    selectedMessageId,
    selectMessage,
    selectedTopic,
    selectTopic,
    messageFilter,
    updateMessageFilter,
    resetMessageFilter,
    dropSubscriptionReferences,
    viewFormat,
    setViewFormat,
    showMessages,
    showTopic,
    publishFocusRequest,
    requestPublishFocus,
    requestMessageExport,
    messageExportRequest,
    /** Connection whose workspace is shown (set by the router), or null. */
    shownConnectionId: unread.shownConnectionId,
    setShownConnection: unread.setShownConnection,
    /**
     * Incoming messages received since the connection's workspace was last shown; 0 while it
     * is shown (CT-12). Reactive; reset by `useMessagesStore().clear(id)`.
     */
    unreadCount: unread.unreadCount,
    forgetConnection
  }
})
