/**
 * State, validation and saving of the subscription dialog (create one, create many, edit).
 * The form works on plain copies: store objects are never mutated before saving. Store errors
 * (invalid or duplicate filter, identifier range, save failures) are kept for inline display.
 *
 * New subscriptions start neutral gray (UX-07) and, on MQTT 5, with Retain As Published on
 * (PRODUCT-03, matching `createSubscription`), so live retained publishes keep their flag. Add
 * multiple hands out distinct palette colors only with "Give each a distinct color".
 */
import { computed, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { Subscription } from '@shared/models'
import { createSubscription } from '@shared/defaults'
import { validateTopicFilter } from '@shared/topic'
import { useConnectionsStore, useSessionsStore, useSubscriptionsStore, useUiStore } from '@/stores'
import { toPlain } from '@/utils/plain'
import { liveFieldsChanged } from '@/utils/subscription'
import { formatCount } from '@/utils/format'
import type { SubmitResult, SubscriptionForm, SubscriptionFormValues } from '../types'
import { bulkColors, defaultSubscriptionColor } from '../utils/colors'
import { firstLine, parseFilterLines } from '../utils/filter-lines'
import { cleanPreset, hasMqtt5Options, messageOf, parseIdentifier } from '../utils/form'

export interface SubscriptionFormState extends SubscriptionForm {
  /** Add multiple: give each new subscription its own palette color (default off: all gray). */
  distinctColors: Ref<boolean>
}

export function useSubscriptionForm(): SubscriptionFormState {
  const ui = useUiStore()
  const dialog = ui.subscriptionDialog
  const connections = useConnectionsStore()
  const sessions = useSessionsStore()
  const subscriptions = useSubscriptionsStore()

  const form = reactive<SubscriptionFormValues>({
    topic: '',
    lines: '',
    multiple: false,
    qos: 0,
    color: '',
    alias: '',
    noLocal: false,
    retainAsPublished: true,
    retainHandling: 0,
    identifier: ''
  })
  const distinctColors = ref(false)
  /** Plain copy of the edited subscription (null = create). */
  const original = shallowRef<Subscription | null>(null)
  /** Plain copy of the dialog preset (create). */
  const preset = shallowRef<Partial<Subscription>>({})
  /** Bumped on every open, so a late save result never touches a newer dialog session. */
  let session = 0
  const submitted = ref(false)
  const saving = ref(false)
  const saveError = ref<string | null>(null)
  const optionsOpen = ref(false)

  const connectionId = computed(() => dialog.connectionId)
  const profile = computed(() =>
    connectionId.value ? connections.get(connectionId.value) : undefined
  )
  const editing = computed(() => dialog.editingId !== null)
  /** Editing a subscription that no longer exists. */
  const missing = computed(() => editing.value && original.value === null)
  const mqtt5 = computed(() => profile.value?.protocolVersion === 5)
  const connected = computed(
    () => connectionId.value !== null && sessions.isConnected(connectionId.value)
  )
  /** Filters of the other subscriptions of the connection (duplicates are refused). */
  const takenTopics = computed(() => {
    const id = connectionId.value
    if (!id) return new Set<string>()
    return new Set(
      subscriptions
        .list(id)
        .filter((sub) => sub.id !== dialog.editingId)
        .map((sub) => sub.topic)
    )
  })

  const topic = computed(() => form.topic.trim())
  const topicError = computed(() => {
    if (form.multiple) return null
    if (!topic.value) return submitted.value ? 'Topic filter is required' : null
    const problem = validateTopicFilter(topic.value)
    if (problem) return problem
    return takenTopics.value.has(topic.value)
      ? `A subscription for "${topic.value}" already exists`
      : null
  })
  const parsed = computed(() =>
    form.multiple ? parseFilterLines(form.lines, takenTopics.value) : null
  )
  const linesError = computed(() => {
    const result = parsed.value
    if (!result) return null
    if (result.invalid) return `Line ${result.invalid.line}: ${result.invalid.error}`
    if (result.filters.length > 0 || !submitted.value) return null
    return result.existing.length > 0
      ? 'These subscriptions already exist'
      : 'Enter at least one topic filter'
  })
  const identifier = computed(() => parseIdentifier(form.identifier))
  const identifierError = computed(() =>
    mqtt5.value && identifier.value === null ? 'Use a whole number from 1 to 268,435,455' : null
  )
  /** The filter to preview against the known topics (a valid single filter). */
  const previewFilter = computed(() =>
    !form.multiple && topic.value && !validateTopicFilter(topic.value) ? topic.value : null
  )

  /** Form fields as subscription fields (MQTT 5 options only for MQTT 5 connections). */
  function fields(): Partial<Subscription> {
    const out: Partial<Subscription> = {
      topic: topic.value,
      qos: form.qos,
      color: form.color,
      alias: form.alias.trim()
    }
    if (mqtt5.value) {
      out.noLocal = form.noLocal
      out.retainAsPublished = form.retainAsPublished
      out.retainHandling = form.retainHandling
      out.subscriptionIdentifier = identifier.value ?? undefined
    }
    return out
  }

  const saveLabel = computed(() => {
    if (editing.value) return 'Save'
    const count = parsed.value?.filters.length ?? 1
    return count > 1 ? `Add ${count} subscriptions` : 'Add subscription'
  })

  /** What saving does on the broker (footer hint). */
  const footerNote = computed(() => {
    if (missing.value) return null
    const base = original.value
    if (!base) {
      if (preset.value.enabled === false) return null
      return connected.value ? 'Subscribes right away' : 'Applied when you connect'
    }
    if (!connected.value || !base.enabled) return null
    return liveFieldsChanged(base, { ...base, ...fields() }) ? 'Re-subscribes on save' : null
  })

  function init(): void {
    session++
    const id = dialog.connectionId
    const edited = id && dialog.editingId ? subscriptions.get(id, dialog.editingId) : undefined
    original.value = edited ? toPlain(edited) : null
    preset.value = edited ? {} : cleanPreset(dialog.preset)
    const source: Partial<Subscription> = original.value ?? preset.value
    const multiple = dialog.multiple && dialog.editingId === null
    Object.assign(form, {
      topic: multiple ? '' : (source.topic ?? ''),
      lines: multiple ? (source.topic ?? '') : '',
      multiple,
      qos: source.qos ?? 0,
      color: source.color ?? defaultSubscriptionColor(),
      alias: source.alias ?? '',
      noLocal: source.noLocal ?? false,
      retainAsPublished: source.retainAsPublished ?? true,
      retainHandling: source.retainHandling ?? 0,
      identifier:
        source.subscriptionIdentifier === undefined ? '' : String(source.subscriptionIdentifier)
    } satisfies SubscriptionFormValues)
    optionsOpen.value = hasMqtt5Options(source)
    distinctColors.value = false
    submitted.value = false
    saving.value = false
    saveError.value = null
  }

  watch(
    () => [dialog.open, dialog.connectionId, dialog.editingId, dialog.preset] as const,
    ([open]) => {
      if (open) init()
    },
    { immediate: true }
  )

  // Switching modes carries the text over.
  watch(
    () => form.multiple,
    (multiple) => {
      if (multiple && !form.lines.trim()) form.lines = topic.value
      else if (!multiple && !topic.value) form.topic = firstLine(form.lines)
    }
  )

  /** The field to focus after a refused submit. */
  function invalidField(): 'topic' | 'identifier' | null {
    if (topicError.value || linesError.value) return 'topic'
    if (identifierError.value) return 'identifier'
    return null
  }

  async function addMany(id: string, token: number): Promise<void> {
    const result = parsed.value
    if (!result) return
    const { filters, existing } = result
    const taken = subscriptions.list(id).map((sub) => sub.color)
    const colors = bulkColors(filters.length, form.color, taken, distinctColors.value)
    const base = { ...preset.value, ...fields(), alias: '' }
    const outcomes = await Promise.allSettled(
      filters.map((filter, index) =>
        subscriptions.add(id, createSubscription({ ...base, topic: filter, color: colors[index] }))
      )
    )
    const failed: string[] = []
    let firstError: unknown = null
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') return
      failed.push(filters[index])
      firstError ??= outcome.reason
    })
    const added = filters.length - failed.length
    if (added > 0) {
      toast.success(`Added ${formatCount(added, 'subscription')}`, {
        description: existing.length > 0 ? `Skipped ${existing.length} existing` : undefined
      })
    }
    if (failed.length === 0) return
    // Keep only what is left to add, so retrying never duplicates.
    if (token === session) form.lines = failed.join('\n')
    const reason = messageOf(firstError)
    throw new Error(added > 0 ? `${reason} (${added} of ${filters.length} added)` : reason)
  }

  async function submit(): Promise<SubmitResult> {
    if (saving.value) return 'failed'
    submitted.value = true
    const id = dialog.connectionId
    if (!id || missing.value) return 'failed'
    if (invalidField()) return 'invalid'
    const token = session
    saving.value = true
    saveError.value = null
    try {
      if (original.value) await subscriptions.update(id, { ...original.value, ...fields() })
      else if (form.multiple) await addMany(id, token)
      else await subscriptions.add(id, createSubscription({ ...preset.value, ...fields() }))
      if (token === session) ui.closeSubscriptionDialog()
      return 'saved'
    } catch (err) {
      const message = messageOf(err)
      if (token === session && dialog.open) saveError.value = message
      else toast.error('Could not save the subscription', { description: message })
      return 'failed'
    } finally {
      if (token === session) saving.value = false
    }
  }

  return {
    form,
    distinctColors,
    profile,
    editing,
    missing,
    mqtt5,
    connected,
    saving,
    saveError,
    optionsOpen,
    topicError,
    linesError,
    identifierError,
    parsed,
    previewFilter,
    saveLabel,
    footerNote,
    invalidField,
    submit
  }
}
