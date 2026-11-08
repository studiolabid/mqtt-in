import { generate } from 'mqtt-packet'
import { describe, expect, it } from 'vitest'
import type { MqttProtocolVersion, PublishRequest } from '@shared/models'
import { utf8Encode } from '@shared/payload'
import { toPublishPacketProperties } from '../../../src/main/services/mqtt/properties'
import {
  assertPublishable,
  MQTT_MAX_PACKET_BYTES,
  publishPacketSize
} from '../../../src/main/services/mqtt/publish-checks'

function request(overrides: Partial<PublishRequest> = {}): PublishRequest {
  return { topic: 'sensors/t', payload: utf8Encode('{"v":1}'), qos: 0, retain: false, ...overrides }
}

/** The bytes mqtt-packet really writes for the request (what mqtt.js sends). */
function encodedSize(req: PublishRequest, version: MqttProtocolVersion): number {
  const properties = version === 5 ? toPublishPacketProperties(req.properties) : undefined
  const packet = {
    cmd: 'publish' as const,
    topic: req.topic,
    payload: Buffer.from(req.payload),
    qos: req.qos,
    retain: req.retain,
    dup: false,
    messageId: req.qos > 0 ? 42 : undefined,
    properties
  }
  return generate(packet, { protocolVersion: version }).length
}

const size = (req: PublishRequest, version: MqttProtocolVersion): number =>
  publishPacketSize(
    req,
    version === 5 ? toPublishPacketProperties(req.properties) : undefined,
    version
  )

describe('publishPacketSize', () => {
  const cases: Array<[string, PublishRequest]> = [
    ['QoS 0, no properties', request()],
    ['QoS 1', request({ qos: 1 })],
    ['empty payload', request({ payload: new Uint8Array() })],
    ['non-ASCII topic', request({ topic: 'häuser/€/温度' })],
    ['varint boundary', request({ payload: new Uint8Array(121) })],
    ['large payload', request({ qos: 2, payload: new Uint8Array(200_000) })],
    [
      'every publish property',
      request({
        qos: 1,
        properties: {
          payloadFormatIndicator: true,
          messageExpiryInterval: 60,
          topicAlias: 3,
          contentType: 'application/json',
          responseTopic: 'reply/to/me',
          correlationData: 'req-ü-1',
          userProperties: [
            { key: 'a', value: '1' },
            { key: 'a', value: 'zwei' },
            { key: 'größe', value: '€' }
          ]
        }
      })
    ]
  ]

  for (const [name, req] of cases) {
    for (const version of [4, 5] as const) {
      it(`matches mqtt-packet byte for byte: ${name} (MQTT ${version === 5 ? '5' : '3.1.1'})`, () => {
        expect(size(req, version)).toBe(encodedSize(req, version))
      })
    }
  }
})

describe('assertPublishable', () => {
  it('needs no broker limits for the string checks', () => {
    const lone = String.fromCharCode(0xd83d)
    expect(() =>
      assertPublishable(request({ topic: `x${lone}` }), undefined, undefined, 4)
    ).toThrow('Topic contains an unpaired surrogate')
    // MQTT 3.1.1 drops the MQTT 5 properties: they are not checked there.
    const contentType = 'ü'.repeat(40_000)
    expect(() =>
      assertPublishable(request({ properties: { contentType } }), undefined, undefined, 4)
    ).not.toThrow()
  })

  it('checks retain and QoS against the CONNACK', () => {
    const limits = { retainAvailable: false, maximumQoS: 0 }
    expect(() => assertPublishable(request({ retain: true }), undefined, limits, 5)).toThrow(
      'The broker does not support retained messages'
    )
    expect(() => assertPublishable(request({ qos: 1 }), undefined, limits, 5)).toThrow(
      'The broker supports QoS 0 only'
    )
  })

  it('words topic alias limits for one and for several aliases', () => {
    const alias = (n: number): PublishRequest => request({ properties: { topicAlias: n } })
    const props = (n: number): ReturnType<typeof toPublishPacketProperties> =>
      toPublishPacketProperties({ topicAlias: n })
    expect(() => assertPublishable(alias(2), props(2), { topicAliasMaximum: 1 }, 5)).toThrow(
      'The broker accepts topic alias 1 only'
    )
    expect(() => assertPublishable(alias(1), props(1), { topicAliasMaximum: 0 }, 5)).toThrow(
      'The broker does not support topic aliases'
    )
    expect(() => assertPublishable(alias(1), props(1), { topicAliasMaximum: 1 }, 5)).not.toThrow()
  })

  it('applies the protocol maximum without an announced Maximum Packet Size', () => {
    // Only the length matters: no need to allocate 256 MB.
    const huge = { byteLength: MQTT_MAX_PACKET_BYTES } as unknown as Uint8Array
    expect(() => assertPublishable(request({ payload: huge }), undefined, {}, 5)).toThrow(
      'Message is 268,435,477 bytes; MQTT allows at most 268,435,460 bytes per packet'
    )
  })
})
