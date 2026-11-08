/**
 * View models of the subscriptions feature (the subscription dialog form).
 */
import type { ComputedRef, Ref } from 'vue'
import type { ConnectionProfile, QoS, RetainHandling } from '@shared/models'
import type { ParsedFilterLines } from './utils/filter-lines'

export interface SubscriptionFormValues {
  topic: string
  /** "Add multiple": one filter per line. */
  lines: string
  multiple: boolean
  qos: QoS
  color: string
  alias: string
  noLocal: boolean
  retainAsPublished: boolean
  retainHandling: RetainHandling
  /** Text of the subscription identifier field (empty = none). */
  identifier: string
}

export type SubmitResult = 'saved' | 'invalid' | 'failed'

export interface SubscriptionForm {
  /** Bind inputs to its fields directly. */
  form: SubscriptionFormValues
  /** Profile of the dialog's connection. */
  profile: ComputedRef<ConnectionProfile | undefined>
  editing: ComputedRef<boolean>
  /** Editing a subscription that no longer exists (saving is impossible). */
  missing: ComputedRef<boolean>
  /** MQTT 5 options apply (MQTT 5.0 connection). */
  mqtt5: ComputedRef<boolean>
  connected: ComputedRef<boolean>
  saving: Ref<boolean>
  /** Store error of the last save (shown inline). */
  saveError: Ref<string | null>
  /** The MQTT 5 options section is expanded. */
  optionsOpen: Ref<boolean>
  topicError: ComputedRef<string | null>
  linesError: ComputedRef<string | null>
  identifierError: ComputedRef<string | null>
  /** "Add multiple" input, parsed (null in single mode). */
  parsed: ComputedRef<ParsedFilterLines | null>
  /** The filter to preview against the known topics (a valid single filter). */
  previewFilter: ComputedRef<string | null>
  saveLabel: ComputedRef<string>
  /** What saving does on the broker (footer hint). */
  footerNote: ComputedRef<string | null>
  /** The field to focus after a refused submit. */
  invalidField(): 'topic' | 'identifier' | null
  submit(): Promise<SubmitResult>
}
