import { describe, expect, it } from 'vitest'
import { brokerView, type BrokerRow } from '@/features/workspace/utils/broker-rows'
import { formatNumber } from '@/utils/format'
import { brokerInfo } from '../../renderer/helpers'

const valueOf = (rows: readonly BrokerRow[], label: string): string | undefined =>
  rows.find((row) => row.label === label)?.value

describe('broker popover rows (FP-5)', () => {
  it('lists everything a MQTT 5 broker announced', () => {
    const view = brokerView({
      connected: true,
      protocolVersion: 5,
      keepalive: 60,
      info: brokerInfo({
        sessionPresent: true,
        assignedClientId: 'auto-7f3a',
        maximumQoS: 1,
        retainAvailable: false,
        serverKeepAlive: 30,
        serverReference: 'other.broker:1883',
        responseInformation: 'replies/'
      })
    })
    expect(view.message).toBeUndefined()
    expect(view.rows.map((row) => row.label)).toEqual([
      'Session present',
      'Assigned client ID',
      'Max QoS',
      'Retain available',
      'Wildcard subscriptions',
      'Shared subscriptions',
      'Subscription identifiers',
      'Receive maximum',
      'Maximum packet size',
      'Topic alias maximum',
      'Server keep alive',
      'Server reference',
      'Response information'
    ])
    expect(view.rows.every((row) => row.announced)).toBe(true)
    expect(valueOf(view.rows, 'Session present')).toBe('Yes')
    expect(valueOf(view.rows, 'Assigned client ID')).toBe('auto-7f3a')
    expect(valueOf(view.rows, 'Max QoS')).toBe('1')
    expect(valueOf(view.rows, 'Retain available')).toBe('No')
    expect(valueOf(view.rows, 'Receive maximum')).toBe(formatNumber(32))
    expect(valueOf(view.rows, 'Maximum packet size')).toBe('1.0 MB')
    expect(valueOf(view.rows, 'Server keep alive')).toBe(`${formatNumber(30)} s`)
  })

  it('shows the protocol default for what a MQTT 5 broker left out', () => {
    const view = brokerView({
      connected: true,
      protocolVersion: 5,
      keepalive: 60,
      info: { protocolVersion: 5, sessionPresent: false }
    })
    const unannounced = view.rows.filter((row) => !row.announced).map((row) => row.label)
    expect(unannounced).toContain('Max QoS')
    expect(valueOf(view.rows, 'Max QoS')).toBe('not announced (default 2)')
    expect(valueOf(view.rows, 'Retain available')).toBe('not announced (default yes)')
    expect(valueOf(view.rows, 'Receive maximum')).toBe(
      `not announced (default ${formatNumber(65_535)})`
    )
    expect(valueOf(view.rows, 'Maximum packet size')).toBe('not announced (default no limit)')
    expect(valueOf(view.rows, 'Topic alias maximum')).toBe('not announced (default 0, no aliases)')
    expect(valueOf(view.rows, 'Server keep alive')).toBe(
      `not announced (default yours, ${formatNumber(60)} s)`
    )
    expect(valueOf(view.rows, 'Session present')).toBe('No')
  })

  it('explains that MQTT 3.x brokers announce nothing but the session', () => {
    const view = brokerView({
      connected: true,
      protocolVersion: 4,
      keepalive: 60,
      info: { protocolVersion: 4, sessionPresent: true }
    })
    expect(view.message).toBe('MQTT 3.1.1 brokers do not announce their limits')
    expect(view.rows).toEqual([{ label: 'Session present', value: 'Yes', announced: true }])
    expect(
      brokerView({ connected: true, protocolVersion: 3, keepalive: 60, info: undefined }).message
    ).toBe('MQTT 3.1 brokers do not announce their limits')
  })

  it('asks to connect while disconnected', () => {
    const view = brokerView({
      connected: false,
      protocolVersion: 5,
      keepalive: 60,
      info: undefined
    })
    expect(view).toEqual({ message: 'Connect to see what the broker supports', rows: [] })
  })

  it('says so when a connected MQTT 5 session has no broker details yet', () => {
    const view = brokerView({ connected: true, protocolVersion: 5, keepalive: 60, info: undefined })
    expect(view.rows).toEqual([])
    expect(view.message).toMatch(/not known/)
  })
})
