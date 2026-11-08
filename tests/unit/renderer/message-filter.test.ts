import { describe, expect, it } from 'vitest'
import { encode as msgpackEncode } from '@msgpack/msgpack'
import type { MqttMessage } from '@shared/models'
import { DEFAULT_MESSAGE_FILTER, type MessageFilter } from '@/types'
import {
  createMessagePredicate,
  isMessageFilterActive,
  searchableText,
  searchCacheFormats,
  subscriptionPredicate,
  type MessagePredicateContext
} from '@/utils/message-filter'
import { collectGarbage, mixedCorpus } from './corpus'
import { message, utf8 } from './helpers'

function filter(patch: Partial<MessageFilter>): MessageFilter {
  return { ...DEFAULT_MESSAGE_FILTER, ...patch }
}

function matching(
  patch: Partial<MessageFilter>,
  topics: string[],
  ctx: MessagePredicateContext = {}
): string[] {
  const predicate = createMessagePredicate(filter(patch), ctx)
  return topics.filter((topic) => predicate(message({ topic })))
}

const TOPICS = ['home/kitchen/temp', 'home/Garden/temp', 'office/temp', '$SYS/uptime', 'home']

describe('isMessageFilterActive', () => {
  it('is false for the default filter', () => {
    expect(isMessageFilterActive(DEFAULT_MESSAGE_FILTER)).toBe(false)
    expect(isMessageFilterActive(filter({ topic: '  ', search: ' ' }))).toBe(false)
  })

  it.each<Partial<MessageFilter>>([
    { direction: 'in' },
    { topic: 'a' },
    { search: 'x' },
    { subscriptionId: 's1' },
    { retainedOnly: true }
  ])('is true for %j', (patch) => {
    expect(isMessageFilterActive(filter(patch))).toBe(true)
  })
})

describe('createMessagePredicate', () => {
  it('matches everything by default', () => {
    expect(matching({}, TOPICS)).toEqual(TOPICS)
  })

  it('filters by direction and retained flag', () => {
    const incoming = createMessagePredicate(filter({ direction: 'in' }))
    expect(incoming(message({ direction: 'in' }))).toBe(true)
    expect(incoming(message({ direction: 'out' }))).toBe(false)
    const outgoing = createMessagePredicate(filter({ direction: 'out' }))
    expect(outgoing(message({ direction: 'out' }))).toBe(true)
    const retained = createMessagePredicate(filter({ retainedOnly: true }))
    expect(retained(message({ retain: true }))).toBe(true)
    expect(retained(message({ retain: false }))).toBe(false)
  })

  it('uses a case-insensitive substring for plain topic filters', () => {
    expect(matching({ topic: 'GARDEN' }, TOPICS)).toEqual(['home/Garden/temp'])
    expect(matching({ topic: ' temp ' }, TOPICS)).toEqual([
      'home/kitchen/temp',
      'home/Garden/temp',
      'office/temp'
    ])
  })

  it('uses MQTT filter semantics for wildcard topic filters', () => {
    expect(matching({ topic: 'home/+/temp' }, TOPICS)).toEqual([
      'home/kitchen/temp',
      'home/Garden/temp'
    ])
    expect(matching({ topic: 'home/#' }, TOPICS)).toEqual([
      'home/kitchen/temp',
      'home/Garden/temp',
      'home'
    ])
    // Wildcards never match $-topics at the first level.
    expect(matching({ topic: '#' }, TOPICS)).not.toContain('$SYS/uptime')
  })

  it('falls back to a substring for invalid wildcard filters', () => {
    expect(matching({ topic: 'te#' }, ['a/te#mp', 'a/temp'])).toEqual(['a/te#mp'])
  })

  it("filters by a subscription's topic filter and ignores unknown subscriptions", () => {
    const ctx: MessagePredicateContext = { subscriptions: [{ id: 's1', topic: 'office/#' }] }
    expect(matching({ subscriptionId: 's1' }, TOPICS, ctx)).toEqual(['office/temp'])
    expect(matching({ subscriptionId: 'gone' }, TOPICS, ctx)).toEqual(TOPICS)
    // Shared subscriptions match on the filter after the share prefix.
    const shared: MessagePredicateContext = { subscriptions: [{ id: 's', topic: '$share/g/home' }] }
    expect(matching({ subscriptionId: 's' }, TOPICS, shared)).toEqual(['home'])
  })

  it('matches the subscription chip by MQTT 5 subscription identifier (MQTT-21)', () => {
    // Overlapping filters: EMQX sends one copy per subscription, each with its identifier.
    const ctx: MessagePredicateContext = {
      subscriptions: [
        { id: 'wide', topic: 'p/ov/#', subscriptionIdentifier: 7 },
        { id: 'narrow', topic: 'p/ov/+', subscriptionIdentifier: 8 }
      ]
    }
    const forSeven = message({ topic: 'p/ov/a', properties: { subscriptionIdentifier: [7] } })
    const forEight = message({ topic: 'p/ov/a', properties: { subscriptionIdentifier: [8] } })
    const both = message({ topic: 'p/ov/a', properties: { subscriptionIdentifier: [7, 8] } })
    const none = message({ topic: 'p/ov/a' })
    const wide = createMessagePredicate(filter({ subscriptionId: 'wide' }), ctx)
    const narrow = createMessagePredicate(filter({ subscriptionId: 'narrow' }), ctx)
    expect([forSeven, forEight, both, none].map(wide)).toEqual([true, false, true, true])
    expect([forSeven, forEight, both, none].map(narrow)).toEqual([false, true, true, true])
    // Without identifiers the topic decides.
    expect(narrow(message({ topic: 'p/ov/a/deep' }))).toBe(false)
  })

  it('falls back to the topic for subscriptions without an identifier', () => {
    const plain = subscriptionPredicate({ topic: 'a/+' })
    expect(plain(message({ topic: 'a/b', properties: { subscriptionIdentifier: [3] } }))).toBe(true)
    expect(plain(message({ topic: 'x' }))).toBe(false)
    const invalid = subscriptionPredicate({ topic: 'a/+', subscriptionIdentifier: 0 })
    expect(invalid(message({ topic: 'a/b', properties: { subscriptionIdentifier: [9] } }))).toBe(
      true
    )
  })

  it('searches topics and decoded payloads case-insensitively', () => {
    const predicate = createMessagePredicate(filter({ search: 'KITCHEN' }))
    expect(predicate(message({ topic: 'home/kitchen/temp', payload: utf8('1') }))).toBe(true)
    expect(predicate(message({ topic: 'x', payload: utf8('{"room":"Kitchen"}') }))).toBe(true)
    expect(predicate(message({ topic: 'x', payload: utf8('bathroom') }))).toBe(false)
  })

  it('searches with the view format (hex for binary data, JSON for MessagePack)', () => {
    const binary = message({ topic: 'bin', payload: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) })
    expect(createMessagePredicate(filter({ search: 'DE AD' }))(binary)).toBe(true)
    const packed = message({ topic: 'p', payload: msgpackEncode({ state: 'ON' }) })
    const auto = createMessagePredicate(filter({ search: '"state"' }), { viewFormat: 'auto' })
    const msgpack = createMessagePredicate(filter({ search: '"state"' }), { viewFormat: 'msgpack' })
    expect(auto(packed)).toBe(false)
    expect(msgpack(packed)).toBe(true)
  })

  it('never matches across the topic / payload boundary', () => {
    const predicate = createMessagePredicate(filter({ search: 'ab\u0000cd' }))
    // NUL is stripped from the term: "abcd" must appear in one of the two parts.
    expect(predicate(message({ topic: 'ab', payload: utf8('cd') }))).toBe(false)
    expect(predicate(message({ topic: 'x', payload: utf8('abcd') }))).toBe(true)
  })

  it('combines every criterion with AND', () => {
    const predicate = createMessagePredicate(
      filter({ direction: 'in', topic: 'home/#', search: 'warm', retainedOnly: true })
    )
    const base = { topic: 'home/a', payload: utf8('warm'), retain: true, direction: 'in' as const }
    expect(predicate(message(base))).toBe(true)
    expect(predicate(message({ ...base, direction: 'out' }))).toBe(false)
    expect(predicate(message({ ...base, topic: 'office/a' }))).toBe(false)
    expect(predicate(message({ ...base, payload: utf8('cold') }))).toBe(false)
    expect(predicate(message({ ...base, retain: false }))).toBe(false)
  })
})

describe('searchableText', () => {
  it('is the lower-cased topic and payload as a view format shows them (reference)', () => {
    const m = message({ topic: 'A/B', payload: utf8('Hello') })
    const first = searchableText(m, 'auto')
    expect(first).toBe('a/b\u0000hello')
    expect(searchableText(m, 'auto')).toBe(first)
    expect(searchableText(m, 'hex')).toBe('a/b\u000048 65 6c 6c 6f')
  })
})

function search(term: string, ctx: MessagePredicateContext = {}): (m: MqttMessage) => boolean {
  return createMessagePredicate(filter({ search: term }), ctx)
}

describe('text search without decoding (PERF-01, PERF-03)', () => {
  const binary = message({ topic: 'bin', payload: Uint8Array.from([0x01, 0xde, 0xad, 0xbe, 0xef]) })

  it("finds the bytes DE AD for the hex term 'de ad' (Hex view, binary payloads in Auto)", () => {
    const hex: MessagePredicateContext = { viewFormat: 'hex' }
    for (const term of ['de ad', 'DEAD', '0xDE 0xAD', 'de:ad', 'ad-be-ef', 'de a']) {
      expect(search(term, hex)(binary), term).toBe(true)
      expect(search(term)(binary), `auto ${term}`).toBe(true)
    }
    for (const term of ['ad de', 'de ae', 'de b', 'ef 00']) {
      expect(search(term, hex)(binary), term).toBe(false)
    }
    // Text in the Hex view: 'Hi' is 48 69.
    const text = message({ topic: 't', payload: utf8('Hi') })
    expect(search('48 69', hex)(text)).toBe(true)
    expect(search('4869', hex)(text)).toBe(true)
  })

  it('matches hex terms in the Auto view only for payloads it shows as hex', () => {
    // 'a' is 0x61, but the Auto view shows this payload as the text 'a', not as '61'.
    const text = message({ topic: 't', payload: utf8('a') })
    expect(search('61')(text)).toBe(false)
    expect(search('61', { viewFormat: 'hex' })(text)).toBe(true)
    // A control character makes the Auto view show hex.
    const control = message({ topic: 't', payload: Uint8Array.from([0x61, 0x01]) })
    expect(search('61 01')(control)).toBe(true)
  })

  it('falls back to the text in the Hex view and finds readable text in binary payloads', () => {
    const mixed = message({
      topic: 'cam',
      payload: Uint8Array.from([0xff, 0x00, ...utf8('Front Door'), 0x9c])
    })
    expect(search('front door', { viewFormat: 'hex' })(mixed)).toBe(true)
    expect(search('FRONT')(mixed)).toBe(true)
    expect(search('back door')(mixed)).toBe(false)
  })

  it('decodes for terms with non-ASCII characters (case-insensitive)', () => {
    const french = message({ topic: 'salle/température', payload: utf8('Température: 21 °C') })
    expect(search('TEMPÉRATURE: 21')(french)).toBe(true)
    expect(search('°c')(french)).toBe(true)
    expect(search('températures')(french)).toBe(false)
    const ascii = message({ topic: 'x', payload: utf8('temperature') })
    expect(search('Température')(ascii)).toBe(false)
    expect(search('SALLE/TEMPÉRATURE')(message({ topic: 'salle/température' }))).toBe(true)
  })

  it('keeps at most one decoded-text cache, for the active view format', () => {
    const packed = message({ topic: 'p', payload: msgpackEncode({ state: 'ON' }) })
    expect(search('"on"', { viewFormat: 'msgpack' })(packed)).toBe(true)
    expect(searchCacheFormats()).toEqual(['msgpack'])
    expect(search('"on"', { viewFormat: 'cbor' })(packed)).toBe(false)
    expect(searchCacheFormats()).toEqual(['cbor'])
    expect(search('gavzdgf0zajptg==', { viewFormat: 'base64' })(packed)).toBe(true)
    expect(searchCacheFormats()).toEqual(['base64'])
    // The byte-level views cache nothing, and a filter without a search drops the cache.
    search('on', { viewFormat: 'text' })(packed)
    expect(searchCacheFormats()).toEqual(['base64'])
    createMessagePredicate(filter({ topic: 'p' }))
    expect(searchCacheFormats()).toEqual([])
  })

  it('keeps the heap flat while searching 100k messages', () => {
    const gc = collectGarbage()
    if (!gc) return // V8 refused to expose a collector: nothing to measure
    const corpus = mixedCorpus(100_000)
    gc()
    const before = process.memoryUsage().heapUsed
    for (const format of ['auto', 'text', 'hex', 'json'] as const) {
      for (const term of ['nominal', 'de ad', 'état']) {
        const predicate = search(term, { viewFormat: format })
        for (const m of corpus) predicate(m)
      }
    }
    gc()
    const grown = process.memoryUsage().heapUsed - before
    expect(corpus).toHaveLength(100_000)
    expect(grown).toBeLessThan(20 * 1024 * 1024)
  })
})
