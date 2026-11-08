/**
 * Cached one-line payload previews for list rows.
 */
import type { MqttMessage, ViewFormat } from '@shared/models'
import { payloadPreview } from '@shared/payload'

const DEFAULT_MAX_CHARS = 240
/** One cache per format + length; WeakMaps let evicted messages be garbage collected. */
const caches = new Map<string, WeakMap<MqttMessage, string>>()

/** One-line preview of a message payload (whitespace collapsed, cut to `maxChars`), cached. */
export function previewOf(
  message: MqttMessage,
  format: ViewFormat,
  maxChars = DEFAULT_MAX_CHARS
): string {
  const key = `${format}:${maxChars}`
  let cache = caches.get(key)
  if (!cache) {
    cache = new WeakMap()
    caches.set(key, cache)
  }
  let preview = cache.get(message)
  if (preview === undefined) {
    preview = payloadPreview(message.payload, format, maxChars)
    cache.set(message, preview)
  }
  return preview
}

/** Lazily computed, cached previews (compute them for visible rows only). */
export function usePayloadPreview(): { previewOf: typeof previewOf } {
  return { previewOf }
}
