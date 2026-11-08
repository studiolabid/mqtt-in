/**
 * Subscription form helpers (pure): MQTT 5 option metadata, identifier parsing and presets.
 */
import type { RetainHandling, Subscription } from '@shared/models'
import { MAX_SUBSCRIPTION_IDENTIFIER } from '@/utils/subscription'
import { toPlain } from '@/utils/plain'

export const RETAIN_HANDLING_OPTIONS: ReadonlyArray<{
  value: RetainHandling
  label: string
  description: string
}> = [
  { value: 0, label: 'Send retained', description: 'On every subscribe' },
  { value: 1, label: 'New subscriptions only', description: 'Not when re-subscribing' },
  { value: 2, label: 'Never send retained', description: 'Only messages published from now on' }
]

/** Narrows a select value to a retain handling option, or `null`. */
export function toRetainHandling(value: unknown): RetainHandling | null {
  const n = typeof value === 'string' ? Number(value) : value
  return n === 0 || n === 1 || n === 2 ? n : null
}

/**
 * Subscription identifier field: `undefined` when empty, `null` when invalid (not a whole
 * number from 1 to 268 435 455).
 */
export function parseIdentifier(text: string): number | undefined | null {
  const raw = text.trim()
  if (raw.length === 0) return undefined
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return value >= 1 && value <= MAX_SUBSCRIPTION_IDENTIFIER ? value : null
}

/**
 * True when any MQTT 5 option differs from its default (Retain As Published defaults to on,
 * `createSubscription`: an explicit `false` counts as custom).
 */
export function hasMqtt5Options(sub: Partial<Subscription>): boolean {
  return (
    sub.noLocal === true ||
    sub.retainAsPublished === false ||
    (sub.retainHandling ?? 0) !== 0 ||
    sub.subscriptionIdentifier !== undefined
  )
}

/** A plain copy of a dialog preset without identity fields (a new subscription gets its own). */
export function cleanPreset(preset: Partial<Subscription> | null): Partial<Subscription> {
  if (!preset) return {}
  const copy = toPlain(preset)
  delete copy.id
  delete copy.createdAt
  return copy
}

/** Preset to create a copy of `sub` (new id, new color; the filter must then be changed). */
export function duplicatePreset(sub: Subscription): Partial<Subscription> {
  return cleanPreset({
    topic: sub.topic,
    qos: sub.qos,
    alias: sub.alias,
    noLocal: sub.noLocal,
    retainAsPublished: sub.retainAsPublished,
    retainHandling: sub.retainHandling,
    subscriptionIdentifier: sub.subscriptionIdentifier
  })
}

/** Message of a thrown value (store errors are already short and human). */
export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return typeof error === 'string' && error ? error : 'Something went wrong'
}
