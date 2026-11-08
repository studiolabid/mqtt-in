/**
 * Turning the bytes of a picked file into an editable payload (pure).
 */
import type { PayloadFormat } from '@shared/models'
import { isPrintableText, toHex, tryParseJson, utf8Decode } from '@shared/payload'

/** Files above this size load with a warning (the editor gets slow, drafts are not saved). */
export const LARGE_PAYLOAD_BYTES = 1024 * 1024

export interface FilePayload {
  payload: string
  format: PayloadFormat
}

/**
 * Printable UTF-8 → text (JSON when it is an object / array that parses), anything else →
 * hex with 16 bytes per line.
 */
export function payloadFromFile(bytes: Uint8Array): FilePayload {
  if (!isPrintableText(bytes)) return { payload: toHex(bytes, ' ', 16), format: 'hex' }
  const text = utf8Decode(bytes)
  const start = text.trimStart()
  const jsonLike = start.startsWith('{') || start.startsWith('[')
  return { payload: text, format: jsonLike && tryParseJson(text).ok ? 'json' : 'text' }
}
