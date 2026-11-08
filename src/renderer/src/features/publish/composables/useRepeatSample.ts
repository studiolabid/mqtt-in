/**
 * The first message a repeat job would send for the current draft: templates rendered with
 * `{{counter}}` = 1 (when on), encoded like the main process will.
 */
import { computed, ref, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { encodePayload } from '@shared/payload'
import { hasTemplate, renderTemplate } from '@shared/template'
import { usePublishStore } from '@/stores'

export interface RepeatSample {
  /** Payload text of the first message. */
  text: string
  /** Templates are on and present: every message is rendered again. */
  templated: boolean
  /** The payload contains template tokens but templates are off (sent literally). */
  literalTokens: boolean
  /** Encoded size in bytes (0 when invalid). */
  bytes: number
  error: string | null
}

export function useRepeatSample(connectionId: MaybeRefOrGetter<string>): {
  sample: ComputedRef<RepeatSample>
  /** Renders the sample again (new random values, uuid, time). */
  reroll(): void
} {
  const publish = usePublishStore()
  const seed = ref(0)

  const sample = computed<RepeatSample>(() => {
    void seed.value
    const draft = publish.draft(toValue(connectionId))
    const tokens = hasTemplate(draft.payload)
    const templated = draft.useTemplate && tokens
    const text = templated ? renderTemplate(draft.payload, { counter: 1 }) : draft.payload
    const base = { text, templated, literalTokens: tokens && !draft.useTemplate }
    try {
      return { ...base, bytes: encodePayload(text, draft.format).length, error: null }
    } catch (err) {
      return { ...base, bytes: 0, error: err instanceof Error ? err.message : String(err) }
    }
  })

  return {
    sample,
    reroll: () => {
      seed.value++
    }
  }
}
