import { describe, expect, it } from 'vitest'
import { encode as msgpackEncode } from '@msgpack/msgpack'
import { exportFileName, messagesToCsv, messagesToJson, toExportedMessage } from '@/utils/export'
import { message, utf8 } from './helpers'

const AT = Date.UTC(2026, 10, 8, 15, 30, 12, 345)

describe('toExportedMessage', () => {
  it('decodes the payload with the view format and keeps the exact bytes as base64', () => {
    const record = toExportedMessage(
      message({ topic: 't', payload: utf8('{"a":1}'), qos: 1, retain: true, timestamp: AT }),
      'auto'
    )
    expect(record).toEqual({
      direction: 'in',
      topic: 't',
      qos: 1,
      retain: true,
      timestamp: '2026-11-08T15:30:12.345Z',
      payload: '{"a":1}',
      payloadEncoding: 'json',
      payloadBase64: 'eyJhIjoxfQ=='
    })
  })

  it('decodes binary formats when forced', () => {
    const record = toExportedMessage(message({ payload: msgpackEncode({ on: true }) }), 'msgpack')
    expect(record.payloadEncoding).toBe('msgpack')
    expect(JSON.parse(record.payload)).toEqual({ on: true })
  })

  it('falls back to auto detection when a forced format does not fit', () => {
    const record = toExportedMessage(message({ payload: utf8('plain text') }), 'msgpack')
    expect(record.payloadEncoding).toBe('text')
    expect(record.payload).toBe('plain text')
  })

  it('includes MQTT 5 properties only when present', () => {
    expect(toExportedMessage(message(), 'auto')).not.toHaveProperty('properties')
    expect(toExportedMessage(message({ properties: {} }), 'auto')).not.toHaveProperty('properties')
    const properties = {
      contentType: 'application/json',
      userProperties: [{ key: 'k', value: 'v' }]
    }
    expect(toExportedMessage(message({ properties }), 'auto').properties).toEqual(properties)
  })
})

describe('messagesToJson', () => {
  it('writes a pretty JSON array in the given order', () => {
    const json = messagesToJson(
      [message({ topic: 'a', timestamp: AT }), message({ topic: 'b', direction: 'out' })],
      'auto'
    )
    const parsed = JSON.parse(json) as Array<{ topic: string; direction: string }>
    expect(parsed.map((m) => [m.topic, m.direction])).toEqual([
      ['a', 'in'],
      ['b', 'out']
    ])
    expect(json).toContain('\n  {')
  })

  it('writes an empty array for no messages', () => {
    expect(messagesToJson([], 'auto')).toBe('[]')
  })
})

describe('messagesToCsv', () => {
  it('writes a header row and CRLF records', () => {
    const csv = messagesToCsv(
      [message({ topic: 'a/b', payload: utf8('42'), timestamp: AT })],
      'auto'
    )
    expect(csv).toBe(
      'timestamp,direction,topic,qos,retain,payload_encoding,payload,payload_base64,properties\r\n' +
        '2026-11-08T15:30:12.345Z,in,a/b,0,false,text,42,NDI=,\r\n'
    )
  })

  it('quotes cells with commas, quotes and line breaks (RFC 4180)', () => {
    const csv = messagesToCsv([message({ payload: utf8('say "hi",\nbye') })], 'text')
    expect(csv).toContain(',"say ""hi"",\nbye",')
  })

  it('neutralizes spreadsheet formulas but keeps plain numbers', () => {
    const formula = messagesToCsv([message({ payload: utf8('=HYPERLINK("x")') })], 'text')
    expect(formula).toContain(`,"'=HYPERLINK(""x"")",`)
    const negative = messagesToCsv([message({ payload: utf8('-5.5') })], 'text')
    expect(negative).toContain(',-5.5,')
    const topic = messagesToCsv([message({ topic: '@cmd' })], 'text')
    expect(topic).toContain(",'@cmd,")
  })

  it('writes properties as JSON and supports a BOM', () => {
    const csv = messagesToCsv([message({ properties: { contentType: 'x' } })], 'auto', {
      bom: true
    })
    expect(csv.startsWith('﻿timestamp,')).toBe(true)
    expect(csv).toContain(',"{""contentType"":""x""}"\r\n')
  })
})

describe('exportFileName', () => {
  const now = new Date(2026, 10, 8, 15, 30, 12)

  it('builds a safe name with the local date and time', () => {
    expect(exportFileName('Home Broker', 'json', now)).toBe('Home-Broker-2026-11-08-153012.json')
  })

  it('removes characters that are invalid in file names', () => {
    expect(exportFileName('a/b\\c:d*e?f"g<h>i|j', 'csv', now)).toBe(
      'a-b-c-d-e-f-g-h-i-j-2026-11-08-153012.csv'
    )
    expect(exportFileName('..hidden..', 'csv', now)).toBe('hidden-2026-11-08-153012.csv')
  })

  it('falls back to "mqtt-in" and normalizes the extension', () => {
    expect(exportFileName('  ///  ', '.CSV', now)).toBe('mqtt-in-2026-11-08-153012.csv')
    expect(exportFileName('x', '', now)).toBe('x-2026-11-08-153012.txt')
  })

  it('keeps unicode names and limits their length', () => {
    expect(exportFileName('Büro 東京', 'json', now)).toBe('Büro-東京-2026-11-08-153012.json')
    const long = exportFileName('n'.repeat(200), 'json', now)
    expect(long).toBe(`${'n'.repeat(60)}-2026-11-08-153012.json`)
  })
})
