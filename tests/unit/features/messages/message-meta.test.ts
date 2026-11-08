/**
 * UX-03 / PRODUCT-02: the message detail opens with one summary line (time · size · QoS ·
 * format) and chips only for the flags that are set.
 */
import { describe, expect, it } from 'vitest'
import {
  detectedFormatLabel,
  messageSummary,
  propertyCount,
  propertyItems
} from '@/features/messages/utils/message-meta'
import { message, utf8 } from '../../renderer/helpers'

/** 08:35:53.313 local time (the summary shows local clock time). */
const AT = new Date(2024, 0, 2, 8, 35, 53, 313).getTime()

describe('messageSummary', () => {
  it('reads time, size, QoS and format in one line', () => {
    const summary = messageSummary(
      message({ timestamp: AT, payload: utf8('{"temperature":21.5,"unit":"C"}'), qos: 0 })
    )
    expect(summary.line).toBe('08:35:53.313 · 31 B · QoS 0 · JSON')
    expect(summary.flags).toEqual([])
  })

  it('formats larger sizes, other QoS levels and formats', () => {
    const text = messageSummary(message({ timestamp: AT, payload: utf8('x'.repeat(1536)), qos: 2 }))
    expect(text.line).toBe('08:35:53.313 · 1.5 KB · QoS 2 · Text')
    const binary = messageSummary(message({ timestamp: AT, payload: new Uint8Array([0, 1, 2]) }))
    expect(binary.line.endsWith('· 3 B · QoS 0 · Binary')).toBe(true)
    const empty = messageSummary(message({ timestamp: AT, payload: new Uint8Array(0) }))
    expect(empty.line).toBe('08:35:53.313 · 0 B · QoS 0 · Empty')
  })

  it('adds chips only for the flags that are set', () => {
    expect(messageSummary(message({ retain: false, dup: false })).flags).toEqual([])
    const flags = messageSummary(message({ retain: true, dup: true })).flags
    expect(flags.map((flag) => flag.label)).toEqual(['Retained', 'DUP'])
    expect(flags.map((flag) => flag.tone)).toEqual(['info', 'warning'])
  })

  it('counts the MQTT 5 properties, user properties included', () => {
    const one = messageSummary(message({ properties: { contentType: 'application/json' } }))
    expect(one.flags.map((flag) => flag.label)).toEqual(['1 MQTT 5 property'])
    const many = message({
      retain: true,
      properties: {
        contentType: 'application/json',
        messageExpiryInterval: 60,
        subscriptionIdentifier: [7],
        userProperties: [
          { key: 'a', value: '1' },
          { key: 'b', value: '2' }
        ]
      }
    })
    expect(propertyCount(many.properties)).toBe(5)
    expect(messageSummary(many).flags.map((flag) => flag.label)).toEqual([
      'Retained',
      '5 MQTT 5 properties'
    ])
  })

  it('has no property chip for MQTT 3.1.1 messages', () => {
    expect(propertyCount(undefined)).toBe(0)
    expect(propertyItems(undefined)).toEqual([])
    expect(messageSummary(message({ properties: undefined })).flags).toEqual([])
  })

  it('labels the detected format', () => {
    expect(detectedFormatLabel(utf8('[1,2]'))).toBe('JSON')
    expect(detectedFormatLabel(utf8('hello'))).toBe('Text')
    expect(detectedFormatLabel(new Uint8Array(0))).toBe('Empty')
  })
})
