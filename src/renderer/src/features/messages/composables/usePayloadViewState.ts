/**
 * View state of the payload in the message detail (UX-05): the format picked there and the
 * payload / diff mode belong to the message on screen. Selecting another message resets them,
 * so a format chosen for one binary message (e.g. MessagePack) never turns the next JSON or
 * text message into a decode error.
 */
import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import type { ViewFormat } from '@shared/models'
import { isViewFormat } from '../utils/message-meta'

export type PayloadMode = 'payload' | 'diff'

export interface PayloadViewState {
  /** Format picked in the detail; `null` follows the connection's view format. */
  localFormat: Ref<ViewFormat | null>
  mode: Ref<PayloadMode>
  /** Accepts a select / toggle value (ignored unless it is a view format). */
  setFormat(value: unknown): void
  /** Accepts a toggle-group value (an empty one keeps the current mode). */
  setMode(value: unknown): void
}

export function usePayloadViewState(messageId: MaybeRefOrGetter<number>): PayloadViewState {
  const localFormat = ref<ViewFormat | null>(null)
  const mode = ref<PayloadMode>('payload')

  watch(
    () => toValue(messageId),
    () => {
      localFormat.value = null
      mode.value = 'payload'
    }
  )

  return {
    localFormat,
    mode,
    setFormat(value) {
      if (isViewFormat(value)) localFormat.value = value
    },
    setMode(value) {
      if (value === 'payload' || value === 'diff') mode.value = value
    }
  }
}
