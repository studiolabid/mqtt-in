/**
 * Topic names and filters as MQTT UTF-8 strings (CT-06, MQTT-18): at most 65,535 bytes, counted
 * in UTF-8, and no unpaired surrogate (TextEncoder / Buffer would send U+FFFD instead, i.e.
 * another topic than the one shown). The main process, the publisher, the subscription dialog and
 * the connection form all use these validators.
 */
import { describe, expect, it } from 'vitest'
import { LIMITS } from '@shared/defaults'
import { validateTopicFilter, validateTopicName } from '@shared/topic'

const MAX_BYTES = LIMITS.maxTopicBytes

describe('validateTopicName: an MQTT string', () => {
  it('accepts exactly 65535 bytes and rejects one byte more', () => {
    expect(validateTopicName('a'.repeat(MAX_BYTES))).toBeNull()
    expect(validateTopicName('a'.repeat(MAX_BYTES + 1))).toBe('Topic is too long (max 65535 bytes)')
  })

  it('measures the limit in UTF-8 bytes, not UTF-16 code units', () => {
    const twoByteChars = 'é'.repeat(Math.ceil(MAX_BYTES / 2)) // 32 768 chars = 65 536 bytes
    expect(twoByteChars.length).toBeLessThan(MAX_BYTES)
    expect(validateTopicName(twoByteChars)).toMatch(/too long/)
  })

  it('counts a surrogate pair as one 4-byte character', () => {
    const pairs = Math.floor(MAX_BYTES / 4) // 16 383 pairs = 65 532 bytes
    expect(validateTopicName(`${'😀'.repeat(pairs)}abc`)).toBeNull() // exactly 65 535 bytes
    expect(validateTopicName('😀'.repeat(pairs + 1))).toMatch(/too long/) // 65 536 bytes
  })

  it.each([
    ['a lone high surrogate', 'a\uD800b'],
    ['a lone low surrogate', 'a\uDC00b'],
    ['a high surrogate at the end', 'home/\uD83D'],
    ['a low surrogate at the start', '\uDE00/home'],
    ['a reversed pair', 'a/\uDE00\uD83D']
  ])('rejects %s (MQTT-18: it would be sent as U+FFFD)', (_case, topic) => {
    expect(validateTopicName(topic)).toBe('Topic contains an unpaired surrogate')
  })

  it('reports the length before an unpaired surrogate', () => {
    expect(validateTopicName(`${'a'.repeat(MAX_BYTES)}\uD800`)).toBe(
      'Topic is too long (max 65535 bytes)'
    )
  })
})

describe('validateTopicFilter: an MQTT string', () => {
  it('accepts exactly 65535 bytes and rejects one byte more', () => {
    expect(validateTopicFilter('a'.repeat(MAX_BYTES))).toBeNull()
    expect(validateTopicFilter('a'.repeat(MAX_BYTES + 1))).toBe(
      'Topic filter is too long (max 65535 bytes)'
    )
  })

  it('counts the shared-subscription prefix against the byte limit', () => {
    const filter = `$share/g/${'a'.repeat(MAX_BYTES - '$share/g/'.length + 1)}`
    expect(validateTopicFilter(filter)).toMatch(/too long/)
  })

  it('accepts surrogate pairs (emoji) at any level', () => {
    expect(validateTopicFilter('😀/+/#')).toBeNull()
    expect(validateTopicFilter('$share/👥/a/😀')).toBeNull()
  })

  it.each([
    ['a level', 'a/\uD800/#'],
    ['a wildcard filter', '+/b\uDC00'],
    ['the share group', '$share/g\uDBFF/a'],
    ['a queue filter', '$queue/\uDFFF']
  ])('rejects an unpaired surrogate in %s', (_case, filter) => {
    expect(validateTopicFilter(filter)).toBe('Topic filter contains an unpaired surrogate')
  })
})
