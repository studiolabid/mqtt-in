/**
 * MQTT-03 / SEC-03 / HEALTH-05: the publish property helpers — the count of what is sent,
 * number parsing, the broker's topic alias hint and the byte-length problems.
 */
import { describe, expect, it } from 'vitest'
import {
  countPublishProperties,
  MAX_UINT16,
  MAX_UINT32,
  parseWholeNumber,
  publishPropertyProblems,
  topicAliasHint
} from '@/features/publish/utils/properties'
import { brokerInfo } from '../../renderer/helpers'

describe('topicAliasHint', () => {
  it('states the broker range', () => {
    expect(topicAliasHint(brokerInfo({ topicAliasMaximum: 5 }))).toBe(
      'The broker accepts topic aliases 1–5'
    )
  })

  it('says when the broker accepts none (0 or not announced)', () => {
    expect(topicAliasHint(brokerInfo({ topicAliasMaximum: 0 }))).toBe(
      'The broker does not support topic aliases'
    )
    expect(topicAliasHint(brokerInfo({ topicAliasMaximum: undefined }))).toBe(
      'The broker does not support topic aliases'
    )
    expect(topicAliasHint(brokerInfo({ protocolVersion: 4, topicAliasMaximum: 10 }))).toBe(
      'The broker does not support topic aliases'
    )
  })

  it('says nothing while the broker is unknown', () => {
    expect(topicAliasHint(undefined)).toBeNull()
  })
})

describe('publishPropertyProblems', () => {
  it('flags strings over 65,535 UTF-8 bytes (a "€" is 3 bytes)', () => {
    expect(publishPropertyProblems({ contentType: '€'.repeat(21_846) }).contentType).toBe(
      'Content type is too long (max 65535 bytes)'
    )
    expect(publishPropertyProblems({ contentType: '€'.repeat(21_845) })).toEqual({})
    expect(publishPropertyProblems({ responseTopic: 'r/'.repeat(40_000) }).responseTopic).toBe(
      'Response topic is too long (max 65535 bytes)'
    )
  })

  it('flags unpaired surrogates in strings', () => {
    expect(publishPropertyProblems({ responseTopic: 'a\uD800b' }).responseTopic).toBe(
      'Response topic contains an unpaired surrogate'
    )
  })

  it('limits correlation data to 65,535 bytes', () => {
    expect(publishPropertyProblems({ correlationData: '€'.repeat(21_846) })).toEqual({
      correlationData: 'Correlation data is too long (max 65535 bytes)'
    })
    expect(publishPropertyProblems({ correlationData: 'x'.repeat(65_535) })).toEqual({})
  })

  it('names the first user property with a problem', () => {
    const problems = publishPropertyProblems({
      userProperties: [
        { key: 'ok', value: 'fine' },
        { key: 'name', value: '€'.repeat(21_846) },
        { key: '€'.repeat(21_846), value: '' }
      ]
    })
    expect(problems.userProperties).toBe('User property 2: the value is too long (max 65535 bytes)')
  })

  it('has nothing to say without properties', () => {
    expect(publishPropertyProblems(undefined)).toEqual({})
    expect(publishPropertyProblems({ userProperties: [] })).toEqual({})
  })
})

describe('countPublishProperties', () => {
  it('counts what would be sent, every user property included', () => {
    expect(countPublishProperties(undefined)).toBe(0)
    expect(countPublishProperties({ userProperties: [] })).toBe(0)
    expect(
      countPublishProperties({
        contentType: 'application/json',
        messageExpiryInterval: 60,
        topicAlias: 0, // not sent
        userProperties: [
          { key: 'a', value: '1' },
          { key: '  ', value: 'blank key: not sent' },
          { key: 'b', value: '' }
        ]
      })
    ).toBe(4)
  })
})

describe('parseWholeNumber', () => {
  it('parses whole numbers in range, unset when empty', () => {
    expect(parseWholeNumber('', 0, MAX_UINT32)).toBeUndefined()
    expect(parseWholeNumber('  ', 0, MAX_UINT32)).toBeUndefined()
    expect(parseWholeNumber(' 42 ', 0, MAX_UINT32)).toBe(42)
    expect(parseWholeNumber(String(MAX_UINT32), 0, MAX_UINT32)).toBe(MAX_UINT32)
  })

  it('rejects anything else', () => {
    expect(parseWholeNumber('0', 1, MAX_UINT16)).toBeNull()
    expect(parseWholeNumber(String(MAX_UINT16 + 1), 1, MAX_UINT16)).toBeNull()
    expect(parseWholeNumber('-1', 0, 10)).toBeNull()
    expect(parseWholeNumber('1.5', 0, 10)).toBeNull()
    expect(parseWholeNumber('1e3', 0, 10_000)).toBeNull()
  })
})
