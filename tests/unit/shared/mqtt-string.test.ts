import { describe, expect, it } from 'vitest'
import {
  hasUnpairedSurrogate,
  MQTT_STRING_MAX_BYTES,
  mqttStringProblem,
  utf8ByteLength
} from '@shared/mqtt-string'

const TOO_LONG = 'is too long (max 65535 bytes)'
const UNPAIRED = 'contains an unpaired surrogate'
/** U+1F600 (4 UTF-8 bytes, a surrogate pair in UTF-16). */
const EMOJI = '\u{1f600}'

describe('utf8ByteLength', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['ü', 2],
    ['€', 3],
    [EMOJI, 4],
    ['a€ü' + EMOJI, 10]
  ])('%j → %d bytes', (value, bytes) => {
    expect(utf8ByteLength(value)).toBe(bytes)
  })

  it('counts exactly like Buffer.byteLength, lone surrogates included (written as U+FFFD)', () => {
    const samples = [
      'plain ascii',
      'Grüße, 温度 21.5 °C',
      `${EMOJI}${EMOJI} done`,
      'a\ud800b',
      '\udc00',
      'x\ud83d',
      '\ude00\ud83d',
      'mixed 😀 \ud800 end'
    ]
    for (const value of samples) expect(utf8ByteLength(value)).toBe(Buffer.byteLength(value))
  })
})

describe('hasUnpairedSurrogate', () => {
  it('accepts well-formed text, surrogate pairs included', () => {
    expect(hasUnpairedSurrogate('')).toBe(false)
    expect(hasUnpairedSurrogate('temp/€/ü')).toBe(false)
    expect(hasUnpairedSurrogate(`${EMOJI}a${EMOJI}`)).toBe(false)
  })

  it.each(['a\ud800b', '\ud800', 'end\udbff', '\udc00start', '\ude00\ud83d', 'x\ud83d\ud83d'])(
    'finds the lone surrogate in %j',
    (value) => {
      expect(hasUnpairedSurrogate(value)).toBe(true)
    }
  )
})

describe('mqttStringProblem', () => {
  it('limits MQTT strings to 65535 UTF-8 bytes', () => {
    expect(MQTT_STRING_MAX_BYTES).toBe(65_535)
  })

  it('accepts 21,845 euro signs (65,535 bytes) and refuses 21,846', () => {
    expect(mqttStringProblem('€'.repeat(21_845))).toBeNull()
    expect(mqttStringProblem('€'.repeat(21_846))).toBe(TOO_LONG)
  })

  it('accepts 65,535 ASCII characters and refuses 65,536', () => {
    expect(mqttStringProblem('a'.repeat(65_535))).toBeNull()
    expect(mqttStringProblem('a'.repeat(65_536))).toBe(TOO_LONG)
  })

  it('counts a surrogate pair as 4 bytes', () => {
    expect(mqttStringProblem(EMOJI.repeat(16_383) + 'abc')).toBeNull()
    expect(mqttStringProblem(EMOJI.repeat(16_384))).toBe(TOO_LONG)
  })

  it('refuses an unpaired surrogate (it cannot be encoded as UTF-8)', () => {
    expect(mqttStringProblem('a\ud800b')).toBe(UNPAIRED)
    expect(mqttStringProblem('\udfff')).toBe(UNPAIRED)
  })

  it('accepts the empty string and ordinary values', () => {
    expect(mqttStringProblem('')).toBeNull()
    expect(mqttStringProblem('application/json')).toBeNull()
    expect(mqttStringProblem(`Grüße ${EMOJI}`)).toBeNull()
  })

  it('returns a lower-case reason for the caller to prefix with the field label', () => {
    const reason = mqttStringProblem('€'.repeat(30_000))
    expect(`Content type ${reason}`).toBe('Content type is too long (max 65535 bytes)')
  })
})
