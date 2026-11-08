/**
 * Building blocks of the fake MQTT 5 broker (`fake-broker5.ts`): one client connection (its
 * protocol version, announced limits, subscriptions, topic aliases and in-flight count) and the
 * record kept of every packet it received.
 */
import type { Socket } from 'node:net'
import {
  generate,
  type IConnackPacket,
  type IPublishPacket,
  type Packet,
  type QoS
} from 'mqtt-packet'
import { topicMatches } from '@shared/topic'

export type ConnackProperties = NonNullable<IConnackPacket['properties']>

export interface ConnackSpec {
  /** MQTT 5 reason code (default 0 = success). A code >= 0x80 closes the connection. */
  reasonCode?: number
  /** Answer with a raw MQTT 3.1.1 CONNACK (2 bytes, no properties) carrying this return code. */
  returnCode?: number
  sessionPresent?: boolean
  properties?: ConnackProperties
}

export interface ReceivedPacket {
  /** Index of the connection in `FakeBroker5.connections`. */
  connection: number
  at: number
  cmd: Packet['cmd']
  /** Bytes on the wire, fixed header included. */
  size: number
  dup: boolean
  qos: number
  retain: boolean
  messageId?: number
  /** PUBLISH topic as sent (empty when only a topic alias was sent). */
  topic?: string
  properties?: Record<string, unknown>
  packet: Packet
}

interface Route {
  filter: string
  qos: QoS
  noLocal: boolean
  retainAsPublished: boolean
  subscriptionIdentifier?: number
}

/** Size of `n` as a variable byte integer (MQTT 5 §1.5.5). */
export function varintSize(n: number): number {
  return n < 128 ? 1 : n < 16_384 ? 2 : n < 2_097_152 ? 3 : 4
}

/** Bytes a parsed packet took on the wire (fixed header + remaining length). */
export function wireSize(packet: Packet): number {
  const length = packet.length ?? 0
  return 1 + varintSize(length) + length
}

export function receivedPacket(connection: number, packet: Packet): ReceivedPacket {
  const entry: ReceivedPacket = {
    connection,
    at: Date.now(),
    cmd: packet.cmd,
    size: wireSize(packet),
    dup: packet.cmd === 'publish' && packet.dup === true,
    qos: packet.cmd === 'publish' ? packet.qos : 0,
    retain: packet.cmd === 'publish' && packet.retain === true,
    packet
  }
  if (packet.messageId !== undefined) entry.messageId = packet.messageId
  if (packet.cmd === 'publish') entry.topic = packet.topic
  if ('properties' in packet && packet.properties) entry.properties = { ...packet.properties }
  return entry
}

export class FakeConnection {
  /** Protocol level of the CONNECT (4 until one arrived). */
  protocolVersion = 4
  /** The CONNACK this connection got; its properties are the limits the broker enforces. */
  connack: ConnackSpec | undefined
  /** QoS 1/2 PUBLISHes received and not acknowledged yet (PUBACK, PUBCOMP, refused PUBREC). */
  inFlight = 0
  open = true
  readonly routes = new Map<string, Route>()
  readonly aliases = new Map<number, string>()
  private nextId = 1

  constructor(
    readonly socket: Socket,
    readonly index: number
  ) {}

  /** The limits announced to an MQTT 5 connection (none for MQTT 3.x or a 3.1.1 CONNACK). */
  get limits(): ConnackProperties {
    const spec = this.connack
    if (this.protocolVersion !== 5 || !spec || spec.returnCode !== undefined) return {}
    return spec.properties ?? {}
  }

  send(packet: Packet): void {
    if (!this.open || this.socket.destroyed) return
    this.socket.write(generate(packet, { protocolVersion: this.protocolVersion }))
  }

  subscribe(filter: string, granted: number, options: Omit<Route, 'filter' | 'qos'>): void {
    this.routes.set(filter, { filter, qos: Math.min(granted, 2) as QoS, ...options })
  }

  /**
   * Delivers `packet` through every matching subscription of this connection (`from` is the
   * publishing connection: No Local skips it). Retain As Published keeps the RETAIN flag.
   */
  deliver(packet: IPublishPacket, from: FakeConnection | null): void {
    if (!this.open) return
    for (const route of this.routes.values()) {
      if (!topicMatches(route.filter, packet.topic)) continue
      if (route.noLocal && from === this) continue
      const qos = Math.min(packet.qos, route.qos) as QoS
      const properties = { ...packet.properties }
      delete properties.topicAlias
      if (route.subscriptionIdentifier !== undefined) {
        properties.subscriptionIdentifier = route.subscriptionIdentifier
      }
      this.send({
        cmd: 'publish',
        topic: packet.topic,
        payload: packet.payload,
        qos,
        retain: route.retainAsPublished ? packet.retain : false,
        dup: false,
        messageId: qos > 0 ? this.packetId() : undefined,
        properties: this.protocolVersion === 5 ? properties : undefined
      })
    }
  }

  private packetId(): number {
    const id = this.nextId
    this.nextId = id === 65_535 ? 1 : id + 1
    return id
  }
}
