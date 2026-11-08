/**
 * Payload codecs (the public entry point, `@shared/payload`): author payloads as
 * text/JSON/hex/base64/MessagePack/CBOR and decode received bytes for display. Pure and
 * environment agnostic (works in Node and the browser — no Buffer).
 *
 * The implementation lives in `./codec/*`: `bytes` (UTF-8, hex, base64), `json` (parse,
 * format, display JSON), `binary-json` (MessagePack / CBOR), `payload-codec` (formats,
 * encode, decode, previews) and `errors` (PayloadError). Import from here.
 */
export { PayloadError } from './codec/errors'
export {
  fromBase64,
  fromHex,
  isPrintableText,
  isValidUtf8,
  toBase64,
  toHex,
  utf8Decode,
  utf8Encode
} from './codec/bytes'
export {
  formatJson,
  type JsonParseResult,
  minifyJson,
  toDisplayJson,
  tryParseJson
} from './codec/json'
export {
  decodePayload,
  type DecodedPayload,
  type DecodeOptions,
  detectFormat,
  encodePayload,
  PAYLOAD_FORMATS,
  payloadPreview,
  VIEW_FORMATS
} from './codec/payload-codec'
