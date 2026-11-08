/**
 * Live, debounced validation of the authored payload: encodes it like a publish would (with
 * templates on, a rendered sample with `{{counter}}` = 1) and reports the size or the problem.
 */
import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import type { PayloadFormat } from '@shared/models'
import { encodePayload } from '@shared/payload'
import { hasTemplate, renderTemplate } from '@shared/template'

export type PayloadStatus =
  | { kind: 'ok'; bytes: number; sample: boolean }
  | { kind: 'error'; message: string; sample: boolean }

export interface PayloadSource {
  payload: string
  format: PayloadFormat
  useTemplate: boolean
}

const DEFAULT_DELAY_MS = 150
/** Big payloads are re-validated less eagerly (encoding a few MB takes a while). */
const LARGE_PAYLOAD_CHARS = 256 * 1024
const LARGE_DELAY_MS = 400

export function evaluatePayload(source: PayloadSource): PayloadStatus {
  const sample = source.useTemplate && hasTemplate(source.payload)
  const text = sample ? renderTemplate(source.payload, { counter: 1 }) : source.payload
  try {
    return { kind: 'ok', bytes: encodePayload(text, source.format).length, sample }
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err), sample }
  }
}

export function usePayloadStatus(
  source: () => PayloadSource,
  delayMs = DEFAULT_DELAY_MS
): Readonly<Ref<PayloadStatus>> {
  const status = shallowRef<PayloadStatus>(evaluatePayload(source()))
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(
    [() => source().payload, () => source().format, () => source().useTemplate],
    ([payload]) => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(
        () => {
          timer = undefined
          status.value = evaluatePayload(source())
        },
        payload.length > LARGE_PAYLOAD_CHARS ? LARGE_DELAY_MS : delayMs
      )
    }
  )

  onScopeDispose(() => {
    if (timer !== undefined) clearTimeout(timer)
  })

  return status
}
