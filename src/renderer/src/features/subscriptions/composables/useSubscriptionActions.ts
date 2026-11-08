/**
 * Actions on the subscriptions of one connection, shared by the rows, the row menu, the list
 * keyboard handler and the header menu. Failures end in a toast (store actions toast their own).
 *
 * Deleting asks no confirmation: the toast offers Undo for `ACTION_TOAST_DURATION` (UX-19),
 * which restores the subscription with its id, options and position.
 */
import { toValue, type MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
import type { Subscription } from '@shared/models'
import { createSubscription } from '@shared/defaults'
import { useCopy } from '@/composables'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { useSubscriptionsStore, useUiStore } from '@/stores'
import { toPlain } from '@/utils/plain'
import { defaultSubscriptionColor } from '../utils/colors'
import { duplicatePreset, messageOf } from '../utils/form'
import { filterPrefix } from '../utils/subscription-view'

export interface SubscriptionActions {
  create(): void
  createMany(): void
  /** Filters the message list by the subscription, or clears that filter when it is active. */
  toggleFilter(sub: Subscription): void
  /** Clears an active subscription filter; returns whether there was one. */
  clearFilter(): boolean
  edit(sub: Subscription): void
  duplicate(sub: Subscription): void
  setEnabled(sub: Subscription, enabled: boolean): Promise<boolean>
  setAllEnabled(enabled: boolean): Promise<void>
  copyFilter(sub: Subscription): void
  copyAllFilters(): void
  showInTopicTree(sub: Subscription): void
  /** Deletes (no confirm) and offers an undo toast; returns whether it was deleted. */
  remove(sub: Subscription): Promise<boolean>
  /** One-click subscription with default options (empty state). */
  quickAdd(topic: string): Promise<boolean>
}

export function useSubscriptionActions(
  connectionId: MaybeRefOrGetter<string>
): SubscriptionActions {
  const subscriptions = useSubscriptionsStore()
  const ui = useUiStore()
  const { copy } = useCopy()
  const id = (): string => toValue(connectionId)

  function toggleFilter(sub: Subscription): void {
    if (ui.messageFilter(id()).subscriptionId === sub.id) {
      ui.updateMessageFilter(id(), { subscriptionId: null })
    } else {
      ui.showMessages(id(), { subscriptionId: sub.id })
    }
  }

  function clearFilter(): boolean {
    if (ui.messageFilter(id()).subscriptionId === null) return false
    ui.updateMessageFilter(id(), { subscriptionId: null })
    return true
  }

  async function setAllEnabled(enabled: boolean): Promise<void> {
    const connection = id()
    const targets = subscriptions.list(connection).filter((sub) => sub.enabled !== enabled)
    // Saves are serialized per profile by the store; going live happens concurrently.
    await Promise.all(targets.map((sub) => subscriptions.setEnabled(connection, sub.id, enabled)))
  }

  function copyAllFilters(): void {
    const topics = subscriptions.list(id()).map((sub) => sub.topic)
    if (topics.length === 0) return
    void copy(topics.join('\n'), topics.length === 1 ? 'filter' : `${topics.length} filters`)
  }

  function showInTopicTree(sub: Subscription): void {
    const prefix = filterPrefix(sub.topic)
    if (prefix) ui.showTopic(id(), prefix)
  }

  async function remove(sub: Subscription): Promise<boolean> {
    const connection = id()
    const snapshot = toPlain(sub)
    const index = subscriptions.list(connection).findIndex((other) => other.id === sub.id)
    if (!(await subscriptions.remove(connection, sub.id))) return false
    toast.success('Subscription deleted', {
      description: snapshot.alias.trim() || snapshot.topic,
      action: { label: 'Undo', onClick: () => void restore(connection, snapshot, index) },
      duration: ACTION_TOAST_DURATION
    })
    return true
  }

  /** Re-adds a deleted subscription (same id and options) at its former position. */
  async function restore(connection: string, snapshot: Subscription, index: number): Promise<void> {
    try {
      await subscriptions.add(connection, snapshot, index >= 0 ? { index } : {})
    } catch (err) {
      toast.error('Could not restore the subscription', { description: messageOf(err) })
    }
  }

  async function quickAdd(topic: string): Promise<boolean> {
    const connection = id()
    try {
      const color = defaultSubscriptionColor()
      await subscriptions.add(connection, createSubscription({ topic, color }))
      return true
    } catch (err) {
      toast.error(`Could not add ${topic}`, { description: messageOf(err) })
      return false
    }
  }

  return {
    create: () => ui.openNewSubscription(id()),
    createMany: () => ui.openNewSubscription(id(), undefined, { multiple: true }),
    toggleFilter,
    clearFilter,
    edit: (sub) => ui.openEditSubscription(id(), sub.id),
    duplicate: (sub) => ui.openNewSubscription(id(), duplicatePreset(sub)),
    setEnabled: (sub, enabled) => subscriptions.setEnabled(id(), sub.id, enabled),
    setAllEnabled,
    copyFilter: (sub) => void copy(sub.topic, 'filter'),
    copyAllFilters,
    showInTopicTree,
    remove,
    quickAdd
  }
}
