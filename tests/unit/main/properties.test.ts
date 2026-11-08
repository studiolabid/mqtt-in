import { describe, expect, it } from 'vitest'
import {
  fromPacketUserProperties,
  fromPublishPacketProperties,
  toConnectPacketProperties,
  toPacketUserProperties,
  toPublishPacketProperties,
  toWillPacketProperties
} from '../../../src/main/services/mqtt/properties'

describe('user properties', () => {
  it('converts a list to a record, grouping duplicate keys', () => {
    expect(
      toPacketUserProperties([
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
        { key: 'a', value: '3' },
        { key: 'a', value: '4' }
      ])
    ).toEqual({ a: ['1', '3', '4'], b: '2' })
  })

  it('omits empty lists and empty keys', () => {
    expect(toPacketUserProperties(undefined)).toBeUndefined()
    expect(toPacketUserProperties([])).toBeUndefined()
    expect(toPacketUserProperties([{ key: '', value: 'x' }])).toBeUndefined()
  })

  it('keeps "__proto__" as ordinary data', () => {
    const record = toPacketUserProperties([{ key: '__proto__', value: 'x' }])
    expect(record && Object.keys(record)).toEqual(['__proto__'])
  })

  it('converts a record back to a list', () => {
    expect(fromPacketUserProperties({ a: ['1', '3'], b: '2' })).toEqual([
      { key: 'a', value: '1' },
      { key: 'a', value: '3' },
      { key: 'b', value: '2' }
    ])
    expect(fromPacketUserProperties({})).toBeUndefined()
    expect(fromPacketUserProperties(undefined)).toBeUndefined()
  })
})

describe('publish properties', () => {
  it('maps app properties to packet properties', () => {
    expect(
      toPublishPacketProperties({
        payloadFormatIndicator: true,
        messageExpiryInterval: 60,
        topicAlias: 3,
        responseTopic: 'reply/to',
        correlationData: 'req-1',
        contentType: 'application/json',
        userProperties: [{ key: 'k', value: 'v' }]
      })
    ).toEqual({
      payloadFormatIndicator: true,
      messageExpiryInterval: 60,
      topicAlias: 3,
      responseTopic: 'reply/to',
      correlationData: Buffer.from('req-1'),
      contentType: 'application/json',
      userProperties: { k: 'v' }
    })
  })

  it('omits undefined, empty and invalid values', () => {
    expect(toPublishPacketProperties(undefined)).toBeUndefined()
    expect(toPublishPacketProperties({})).toBeUndefined()
    expect(
      toPublishPacketProperties({
        topicAlias: 0,
        responseTopic: '',
        correlationData: '',
        contentType: '',
        userProperties: []
      })
    ).toBeUndefined()
    expect(toPublishPacketProperties({ messageExpiryInterval: 0 })).toEqual({
      messageExpiryInterval: 0
    })
  })

  it('maps received packet properties to message properties', () => {
    expect(
      fromPublishPacketProperties({
        payloadFormatIndicator: false,
        correlationData: Buffer.from('req-7'),
        subscriptionIdentifier: 4,
        userProperties: { a: ['1', '2'] }
      })
    ).toEqual({
      payloadFormatIndicator: false,
      correlationData: 'req-7',
      subscriptionIdentifier: [4],
      userProperties: [
        { key: 'a', value: '1' },
        { key: 'a', value: '2' }
      ]
    })
    expect(fromPublishPacketProperties({ subscriptionIdentifier: [1, 9] })).toEqual({
      subscriptionIdentifier: [1, 9]
    })
    expect(fromPublishPacketProperties({ correlationData: Buffer.alloc(0) })).toBeUndefined()
    expect(fromPublishPacketProperties(undefined)).toBeUndefined()
  })

  it('round-trips through packet properties', () => {
    const props = {
      contentType: 'text/plain',
      correlationData: 'abc',
      userProperties: [
        { key: 'x', value: '1' },
        { key: 'y', value: '2' }
      ]
    }
    expect(fromPublishPacketProperties(toPublishPacketProperties(props))).toEqual(props)
  })
})

describe('connect and will properties', () => {
  it('maps connect properties, omitting unset ones', () => {
    expect(toConnectPacketProperties({ userProperties: [] })).toBeUndefined()
    expect(
      toConnectPacketProperties({
        sessionExpiryInterval: 0,
        topicAliasMaximum: 10,
        requestResponseInformation: false,
        userProperties: [{ key: 'app', value: 'mqtt-in' }]
      })
    ).toEqual({
      sessionExpiryInterval: 0,
      topicAliasMaximum: 10,
      requestResponseInformation: false,
      userProperties: { app: 'mqtt-in' }
    })
  })

  it('maps will properties with binary correlation data', () => {
    expect(toWillPacketProperties({ userProperties: [] })).toBeUndefined()
    expect(
      toWillPacketProperties({
        willDelayInterval: 10,
        messageExpiryInterval: 30,
        payloadFormatIndicator: true,
        correlationData: 'c',
        userProperties: []
      })
    ).toEqual({
      willDelayInterval: 10,
      messageExpiryInterval: 30,
      payloadFormatIndicator: true,
      correlationData: Buffer.from('c')
    })
  })
})
