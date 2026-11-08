/**
 * A spec-following MQTT 5 broker for regression tests (MQTT 3.1.1 clients work too): one TCP
 * server on 127.0.0.1:<random port>, mqtt-packet for the wire format, no network access.
 *
 * - Configurable CONNACK: an MQTT 5 reason code, or a raw MQTT 3.1.1 return code (what a
 *   3.1.1-only broker answers to an MQTT 5 CONNECT), `sessionPresent` and the properties
 *   (Receive Maximum, Maximum Packet Size, Topic Alias Maximum, Maximum QoS, capabilities…).
 * - Enforces what it announced like a real broker: DISCONNECT (MQTT 5 only) and close for a
 *   packet over Maximum Packet Size (0x95), more QoS 1/2 PUBLISHes in flight than Receive Maximum
 *   (0x93), a topic alias out of range (0x94), retain (0x9A) or QoS (0x9B) it does not support,
 *   wildcard (0xA2), shared (0x9E) or subscription identifier (0xA1) subscriptions it does not
 *   support, and malformed packets (0x81).
 * - Hooks: ack delay, PUBACK / SUBACK reason codes, DISCONNECT instead of an ack, holding an ack
 *   back, PINGRESP delay. PUBLISHes are routed to every matching subscription before the PUBACK
 *   is sent (the publisher's own subscription gets the echo first).
 * - Records every received packet, the DISCONNECTs it sent and the peak number of QoS 1/2
 *   PUBLISHes in flight on one connection.
 */
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import {
  generate,
  parser,
  type IConnectPacket,
  type IPublishPacket,
  type ISubscribePacket,
  type Packet
} from 'mqtt-packet'
import { isSharedSubscription } from '@shared/topic'
import {
  type ConnackSpec,
  FakeConnection,
  receivedPacket,
  type ReceivedPacket
} from './fake-broker5-wire'

export type { ConnackProperties, ConnackSpec, ReceivedPacket } from './fake-broker5-wire'
export { FakeConnection, varintSize } from './fake-broker5-wire'

/** What to do with one PUBLISH (returned by `onPublish`). */
export interface PublishDecision {
  /** Answer with DISCONNECT <code> and close the connection instead of acknowledging. */
  disconnect?: number
  /** PUBACK / PUBREC reason code (default 0). */
  reasonCode?: number
  /** Delay before the ack, ms (default: `ackDelayMs`). */
  ackDelayMs?: number
  /** Never acknowledge (the PUBLISH stays in flight). */
  hold?: boolean
}

export interface SubscribeDecision {
  disconnect?: number
  /** One SUBACK reason code per subscription (default: the granted QoS). */
  reasonCodes?: number[]
}

export interface FakeBroker5Options {
  /** The CONNACK for every CONNECT (`index` counts the CONNECTs, from 0). */
  connack?: ConnackSpec | ((connect: IConnectPacket, index: number) => ConnackSpec)
  /** Delay before PUBACK / PUBREC, ms. */
  ackDelayMs?: number
  /** Delay before PINGRESP, ms. */
  pingDelayMs?: number
  onPublish?: (packet: IPublishPacket, connection: FakeConnection) => PublishDecision | void
  onSubscribe?: (packet: ISubscribePacket, connection: FakeConnection) => SubscribeDecision | void
}

export class FakeBroker5 {
  readonly packets: ReceivedPacket[] = []
  readonly connections: FakeConnection[] = []
  readonly disconnectsSent: Array<{ connection: number; code: number; at: number }> = []
  /** Most QoS 1/2 PUBLISHes ever in flight on one connection. */
  maxInFlight = 0
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(
    private readonly server: Server,
    readonly port: number,
    /** Mutable: tests may change hooks and delays while clients are connected. */
    public options: FakeBroker5Options
  ) {
    server.on('connection', (socket) => this.accept(socket))
  }

  get connects(): IConnectPacket[] {
    return this.received('connect')
  }

  get publishes(): IPublishPacket[] {
    return this.received('publish')
  }

  get subscribes(): ISubscribePacket[] {
    return this.received('subscribe')
  }

  /** Received packets of one kind, in arrival order. */
  received<C extends Packet['cmd']>(cmd: C): Extract<Packet, { cmd: C }>[] {
    return this.packets
      .filter((entry) => entry.cmd === cmd)
      .map((entry) => entry.packet as Extract<Packet, { cmd: C }>)
  }

  /** Sends DISCONNECT <code> to every open connection and closes it. */
  disconnectAll(code: number, properties?: Record<string, unknown>): void {
    for (const connection of this.connections) this.disconnect(connection, code, properties)
  }

  /** Destroys every connection without a DISCONNECT (a network failure). */
  dropAll(): void {
    for (const connection of this.connections) connection.socket.destroy()
  }

  /** Routes a PUBLISH as if a peer client had sent it. */
  deliver(packet: Omit<IPublishPacket, 'cmd' | 'dup'>): void {
    const publish: IPublishPacket = { cmd: 'publish', dup: false, ...packet }
    for (const connection of this.connections) connection.deliver(publish, null)
  }

  async close(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    for (const connection of this.connections) connection.socket.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  private accept(socket: Socket): void {
    const connection = new FakeConnection(socket, this.connections.length)
    this.connections.push(connection)
    const wire = parser()
    socket.on('error', () => {})
    socket.on('close', () => {
      connection.open = false
    })
    wire.on('packet', (packet: Packet) => this.handle(connection, packet))
    wire.on('error', () => this.disconnect(connection, 0x81))
    socket.on('data', (chunk: Buffer) => wire.parse(chunk))
  }

  private handle(connection: FakeConnection, packet: Packet): void {
    if (!connection.open) return
    const entry = receivedPacket(connection.index, packet)
    this.packets.push(entry)
    if (packet.cmd === 'connect') return this.onConnect(connection, packet)
    const max = connection.limits.maximumPacketSize
    if (max !== undefined && entry.size > max) return this.disconnect(connection, 0x95)
    switch (packet.cmd) {
      case 'publish':
        return this.onPublish(connection, packet)
      case 'pubrel':
        connection.inFlight = Math.max(0, connection.inFlight - 1)
        return connection.send({ cmd: 'pubcomp', messageId: packet.messageId })
      case 'pubrec':
        return connection.send({ cmd: 'pubrel', messageId: packet.messageId })
      case 'subscribe':
        return this.onSubscribe(connection, packet)
      case 'unsubscribe': {
        const granted = packet.unsubscriptions.map((filter) =>
          connection.routes.delete(filter) ? 0 : 0x11
        )
        return connection.send({ cmd: 'unsuback', messageId: packet.messageId, granted })
      }
      case 'pingreq':
        return this.later(this.options.pingDelayMs ?? 0, () => connection.send({ cmd: 'pingresp' }))
      case 'disconnect':
        connection.socket.end()
        return
      default:
        return
    }
  }

  private onConnect(connection: FakeConnection, packet: IConnectPacket): void {
    if (connection.connack) return this.disconnect(connection, 0x82) // a second CONNECT
    connection.protocolVersion = packet.protocolVersion ?? 4
    const option = this.options.connack ?? {}
    const spec = typeof option === 'function' ? option(packet, this.connects.length - 1) : option
    connection.connack = spec
    const sessionPresent = spec.sessionPresent ?? false
    if (spec.returnCode !== undefined) {
      // A 3.1.1 broker answers in its own format, whatever the client asked for.
      const connack = { cmd: 'connack' as const, returnCode: spec.returnCode, sessionPresent }
      connection.socket.write(generate(connack, { protocolVersion: 4 }))
      if (spec.returnCode !== 0) this.closeAfterRefusal(connection)
      return
    }
    const code = spec.reasonCode ?? 0
    if (connection.protocolVersion === 5) {
      const { properties } = spec
      connection.send({ cmd: 'connack', reasonCode: code, sessionPresent, properties })
    } else {
      connection.send({ cmd: 'connack', returnCode: code === 0 ? 0 : 5, sessionPresent })
    }
    if (code !== 0) this.closeAfterRefusal(connection)
  }

  private onPublish(connection: FakeConnection, packet: IPublishPacket): void {
    const limits = connection.limits
    const alias = packet.properties?.topicAlias
    let topic = packet.topic
    if (alias !== undefined) {
      if (!limits.topicAliasMaximum || alias < 1 || alias > limits.topicAliasMaximum) {
        return this.disconnect(connection, 0x94)
      }
      if (topic === '') topic = connection.aliases.get(alias) ?? ''
      else connection.aliases.set(alias, topic)
    }
    if (topic === '') return this.disconnect(connection, 0x82)
    if (packet.retain && limits.retainAvailable === false) return this.disconnect(connection, 0x9a)
    if (limits.maximumQoS !== undefined && packet.qos > limits.maximumQoS) {
      return this.disconnect(connection, 0x9b)
    }
    if (packet.qos > 0) {
      connection.inFlight++
      this.maxInFlight = Math.max(this.maxInFlight, connection.inFlight)
      if (connection.inFlight > (limits.receiveMaximum ?? 65_535)) {
        return this.disconnect(connection, 0x93)
      }
    }
    const decision = this.options.onPublish?.(packet, connection) ?? {}
    if (decision.disconnect !== undefined) return this.disconnect(connection, decision.disconnect)
    const routed: IPublishPacket = { ...packet, topic }
    for (const target of this.connections) target.deliver(routed, connection)
    if (packet.qos === 0 || decision.hold) return
    const reasonCode = decision.reasonCode ?? 0
    this.later(decision.ackDelayMs ?? this.options.ackDelayMs ?? 0, () => {
      if (packet.qos === 1 || reasonCode >= 0x80) {
        connection.inFlight = Math.max(0, connection.inFlight - 1)
      }
      const { messageId } = packet
      if (packet.qos === 1) connection.send({ cmd: 'puback', messageId, reasonCode })
      else connection.send({ cmd: 'pubrec', messageId, reasonCode })
    })
  }

  private onSubscribe(connection: FakeConnection, packet: ISubscribePacket): void {
    const limits = connection.limits
    const id = packet.properties?.subscriptionIdentifier
    if (id !== undefined && limits.subscriptionIdentifiersAvailable === false) {
      return this.disconnect(connection, 0xa1)
    }
    for (const { topic } of packet.subscriptions) {
      if (limits.wildcardSubscriptionAvailable === false && /[+#]/.test(topic)) {
        return this.disconnect(connection, 0xa2)
      }
      if (limits.sharedSubscriptionAvailable === false && isSharedSubscription(topic)) {
        return this.disconnect(connection, 0x9e)
      }
    }
    const decision = this.options.onSubscribe?.(packet, connection) ?? {}
    if (decision.disconnect !== undefined) return this.disconnect(connection, decision.disconnect)
    const granted = packet.subscriptions.map((sub, i) => {
      const code = decision.reasonCodes?.[i] ?? Math.min(sub.qos, limits.maximumQoS ?? 2)
      if (code < 0x80) {
        connection.subscribe(sub.topic, code, {
          noLocal: sub.nl === true,
          retainAsPublished: sub.rap === true,
          subscriptionIdentifier: id
        })
      }
      return code
    })
    connection.send({ cmd: 'suback', messageId: packet.messageId, granted })
  }

  /** MQTT 5: DISCONNECT <code>, then close. MQTT 3.x has no server DISCONNECT: just close. */
  private disconnect(
    connection: FakeConnection,
    code: number,
    properties?: Record<string, unknown>
  ): void {
    if (!connection.open) return
    this.disconnectsSent.push({ connection: connection.index, code, at: Date.now() })
    if (connection.protocolVersion === 5) {
      connection.send({ cmd: 'disconnect', reasonCode: code, properties })
    }
    connection.open = false
    connection.socket.end()
  }

  /** Closes after a refused CONNACK (the client reads it first). */
  private closeAfterRefusal(connection: FakeConnection): void {
    connection.open = false
    connection.socket.end()
  }

  private later(ms: number, task: () => void): void {
    if (ms <= 0) return task()
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      task()
    }, ms)
    this.timers.add(timer)
  }
}

/** Starts a fake broker on 127.0.0.1 with a random port. Call `close()` when done. */
export async function startFakeBroker5(options: FakeBroker5Options = {}): Promise<FakeBroker5> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return new FakeBroker5(server, port, options)
}
