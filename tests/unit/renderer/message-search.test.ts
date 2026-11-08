import { describe, expect, it } from 'vitest'
import type { MqttMessage, ViewFormat } from '@shared/models'
import { searchableText } from '@/utils/message-filter'
import {
  createSearchPredicate,
  includesHex,
  normalizeSearchTerm,
  parseHexTerm,
  SEARCH_MAX_BYTES
} from '@/utils/message-search'
import { message, utf8 } from './helpers'

/** Deterministic PRNG (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// No 'İ' or Kelvin sign: their lower case contains ASCII letters, which the byte-level ASCII
// search does not fold (a documented trade-off; see message-search.ts).
const WORDS = [
  'temp',
  'Temperature',
  'STATUS',
  'ok',
  '"t":21.5',
  '{"state":"ON"}',
  'kitchen/light',
  'Température',
  'Größe',
  'ÄÖÜ äöü',
  'naïve café',
  'Ελλάδα ΟΔΟΣ',
  'Москва',
  '温度センサー',
  'データ',
  '😀 emoji',
  'ß',
  'ﬁle',
  '½ °C',
  'ǅemal',
  'tab\there',
  'line\nbreak'
]

function corpus(count: number, rand: () => number): MqttMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const words = Array.from(
      { length: 1 + Math.floor(rand() * 6) },
      () => WORDS[Math.floor(rand() * WORDS.length)]
    )
    const topic = `room${i % 7}/${WORDS[i % WORDS.length].replace(/[\s/+#]/g, '_')}`
    return message({ topic, payload: utf8(words.join(' ')) })
  })
}

/** A substring of some payload or topic with its ASCII letters in random case. */
function termFrom(messages: readonly MqttMessage[], rand: () => number): string {
  const m = messages[Math.floor(rand() * messages.length)]
  const text = rand() < 0.2 ? m.topic : new TextDecoder().decode(m.payload)
  const chars = Array.from(text)
  const start = Math.floor(rand() * chars.length)
  const length = 1 + Math.floor(rand() * 8)
  return chars
    .slice(start, start + length)
    .map((ch) => (rand() < 0.5 ? ch.toUpperCase() : ch))
    .join('')
}

describe('createSearchPredicate', () => {
  it('equals the decoding reference on text payloads (Auto, Text, JSON)', () => {
    const rand = random(20251108)
    const messages = corpus(400, rand)
    const terms = Array.from({ length: 150 }, () => termFrom(messages, rand))
    terms.push('zz', 'é', 'ΣΤ', '温', 'not there', 'ÉTAT', 'größe café')
    let hits = 0
    let mismatches = 0
    for (const format of ['auto', 'text', 'json'] as const satisfies readonly ViewFormat[]) {
      const reference = messages.map((m) => searchableText(m, format))
      for (const raw of terms) {
        const term = normalizeSearchTerm(raw)
        if (!term) continue
        const predicate = createSearchPredicate(term, format)
        messages.forEach((m, index) => {
          const expected = reference[index].includes(term)
          if (predicate(m) !== expected) {
            mismatches++
            expect
              .soft(predicate(m), `${format} ${JSON.stringify(raw)} in ${m.topic}`)
              .toBe(expected)
          }
          if (expected) hits++
        })
      }
    }
    expect(mismatches).toBe(0)
    expect(hits).toBeGreaterThan(1000)
  })

  it('finds non-ASCII terms whose lower case differs in length (İ)', () => {
    const turkish = message({ topic: 't', payload: utf8('İSTANBUL') })
    const term = normalizeSearchTerm('İSTANBUL') // 'i̇stanbul': i + combining dot
    expect(createSearchPredicate(term, 'auto')(turkish)).toBe(true)
    expect(createSearchPredicate(normalizeSearchTerm('İst'), 'text')(turkish)).toBe(true)
  })

  it('searches only the first SEARCH_MAX_BYTES bytes', () => {
    // 'near' ends exactly at the limit; the space after it is beyond.
    const filler = 'x'.repeat(SEARCH_MAX_BYTES - 4)
    const big = message({ topic: 't', payload: utf8(`${filler}near beyond`) })
    expect(createSearchPredicate('near', 'text')(big)).toBe(true)
    expect(createSearchPredicate('near ', 'text')(big)).toBe(false)
    expect(createSearchPredicate('beyond', 'text')(big)).toBe(false)
    expect(createSearchPredicate('6e 65 61 72', 'hex')(big)).toBe(true)
    expect(createSearchPredicate('6e 65 61 72 20', 'hex')(big)).toBe(false)
  })

  it('uses the Auto view rule for payloads cut at the limit', () => {
    // Printable text with a multi-byte character split by the cut: still shown as text.
    const text = message({ topic: 't', payload: utf8(`${'a'.repeat(SEARCH_MAX_BYTES - 1)}é…`) })
    expect(createSearchPredicate('61 61', 'auto')(text)).toBe(false)
    // A large binary payload: shown as hex.
    const bytes = new Uint8Array(SEARCH_MAX_BYTES * 2).fill(0xff)
    bytes[10] = 0xca
    bytes[11] = 0xfe
    expect(createSearchPredicate('ca fe', 'auto')(message({ topic: 't', payload: bytes }))).toBe(
      true
    )
  })

  it('never matches the empty payload', () => {
    const empty = message({ topic: 'a/b', payload: new Uint8Array(0) })
    for (const format of ['auto', 'text', 'hex', 'base64', 'msgpack'] as const) {
      expect(createSearchPredicate('zz', format)(empty)).toBe(false)
      expect(createSearchPredicate('a/b', format)(empty)).toBe(true) // the topic
    }
  })
})

describe('hex terms', () => {
  it('parses bytes, separators, 0x prefixes and an odd last digit', () => {
    expect(parseHexTerm('de ad')).toEqual({ bytes: Uint8Array.from([0xde, 0xad]), nibble: -1 })
    expect(parseHexTerm('0xde,0xad')).toEqual({ bytes: Uint8Array.from([0xde, 0xad]), nibble: -1 })
    expect(parseHexTerm('de:a')).toEqual({ bytes: Uint8Array.from([0xde]), nibble: 0xa })
    expect(parseHexTerm('f')).toEqual({ bytes: new Uint8Array(0), nibble: 0xf })
    for (const term of ['', '0x', 'temp', 'de ad zz', '12.5']) expect(parseHexTerm(term)).toBeNull()
  })

  it('matches byte sequences with the trailing nibble', () => {
    const bytes = Uint8Array.from([0x00, 0xde, 0xad, 0xbe])
    const hex = (term: string): boolean => {
      const parsed = parseHexTerm(term)
      return parsed !== null && includesHex(bytes, parsed)
    }
    expect(hex('dead')).toBe(true)
    expect(hex('dea')).toBe(true)
    expect(hex('deb')).toBe(false)
    expect(hex('b')).toBe(true)
    expect(hex('c')).toBe(false)
    expect(hex('adbe')).toBe(true)
    expect(hex('be0')).toBe(false) // no byte after be
  })
})
