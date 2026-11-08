/**
 * After the user switches the payload format, offers to rewrite the payload so it keeps
 * sending the same bytes (e.g. `Hello` as text → `48 65 6c 6c 6f` as hex). The offer lasts
 * until the payload or the format changes again.
 */
import { computed, shallowRef, type ComputedRef } from 'vue'
import type { PayloadFormat } from '@shared/models'
import { hasTemplate } from '@shared/template'
import type { PublishDraft } from '@/types'
import { convertPayload } from '../utils/payload-tools'

interface ConversionOffer {
  from: PayloadFormat
  to: PayloadFormat
  source: string
  result: string
}

export interface FormatConversion {
  /** Format to offer converting from, or null when there is nothing to offer. */
  convertFrom: ComputedRef<PayloadFormat | null>
  /** Applies a format picked by the user and prepares the offer. */
  pickFormat(next: PayloadFormat): void
  /** Rewrites the payload. @returns whether it changed. */
  convert(): boolean
  /** Drops the offer (e.g. another connection). */
  reset(): void
}

export function useFormatConversion(draft: () => PublishDraft): FormatConversion {
  const offer = shallowRef<ConversionOffer | null>(null)

  const convertFrom = computed(() => {
    const current = offer.value
    const value = draft()
    return current && current.to === value.format && current.source === value.payload
      ? current.from
      : null
  })

  function pickFormat(next: PayloadFormat): void {
    const value = draft()
    if (next === value.format) return
    const from = value.format
    // Converting would bake template tokens into literal bytes.
    const templated = value.useTemplate && hasTemplate(value.payload)
    const result = templated ? null : convertPayload(value.payload, from, next)
    value.format = next
    offer.value = result === null ? null : { from, to: next, source: value.payload, result }
  }

  function convert(): boolean {
    const current = offer.value
    if (!current || convertFrom.value === null) return false
    draft().payload = current.result
    offer.value = null
    return true
  }

  return {
    convertFrom,
    pickFormat,
    convert,
    reset: () => {
      offer.value = null
    }
  }
}
