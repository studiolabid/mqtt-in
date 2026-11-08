import { describe, expect, it } from 'vitest'
import * as payload from '@shared/payload'

/** Every runtime export of `@shared/payload` before it became a barrel over `./codec/*`. */
const PUBLIC_API = [
  'PAYLOAD_FORMATS',
  'PayloadError',
  'VIEW_FORMATS',
  'decodePayload',
  'detectFormat',
  'encodePayload',
  'formatJson',
  'fromBase64',
  'fromHex',
  'isPrintableText',
  'isValidUtf8',
  'minifyJson',
  'payloadPreview',
  'toBase64',
  'toDisplayJson',
  'toHex',
  'tryParseJson',
  'utf8Decode',
  'utf8Encode'
]

describe('@shared/payload barrel', () => {
  it('still exposes the codec functions', () => {
    const api = payload as Record<string, unknown>
    for (const name of [
      'encodePayload',
      'decodePayload',
      'detectFormat',
      'payloadPreview',
      'toHex',
      'fromHex'
    ]) {
      expect([name, typeof api[name]]).toEqual([name, 'function'])
    }
  })

  it('exposes exactly the public API (no codec internals)', () => {
    expect(Object.keys(payload).sort()).toEqual([...PUBLIC_API].sort())
  })

  it('works end to end through the barrel', () => {
    const bytes = payload.encodePayload('{"a":1}', 'msgpack')
    expect(payload.toHex(bytes, '')).toBe('81a16101')
    expect(payload.decodePayload(bytes, 'msgpack', { pretty: false }).text).toBe('{"a":1}')
    expect(payload.fromHex('81a16101')).toEqual(bytes)
    expect(new payload.PayloadError('x')).toBeInstanceOf(Error)
  })
})
