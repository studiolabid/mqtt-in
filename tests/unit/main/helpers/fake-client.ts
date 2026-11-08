/**
 * A scripted stand-in for the mqtt.js client, used to test MQTT 5 behaviour that the
 * in-process aedes broker (MQTT 3.1.1 only) cannot produce.
 */
import { EventEmitter } from 'node:events'
import type {
  IClientOptions,
  IClientPublishOptions,
  IClientSubscribeOptions,
  IConnackPacket,
  IDisconnectPacket,
  IPublishPacket,
  MqttClient,
  Packet
} from 'mqtt'
import type { ConnectFn } from '../../../../src/main/services/mqtt/types'

type SubscribeCallback = (err: Error | null, granted?: unknown[], packet?: Packet) => void
type PacketCallback = (err?: Error, packet?: Packet) => void

class FakeStream extends EventEmitter {
  destroyed = false
  destroy(): void {
    this.destroyed = true
  }
}

export class FakeMqttClient extends EventEmitter {
  readonly options: IClientOptions
  disconnecting = false
  stream = new FakeStream()
  readonly subscribed: Array<{ topic: string; options: IClientSubscribeOptions }> = []
  readonly published: Array<{ topic: string; payload: Buffer; options: IClientPublishOptions }> = []
  readonly ended: boolean[] = []
  /** SUBACK reason code returned by the next subscribe calls. */
  subackCode = 0
  /** When false, QoS 0 publish callbacks are never called (simulates a stuck socket). */
  completePublishes = true

  constructor(
    readonly url: string,
    options: IClientOptions
  ) {
    super()
    this.options = options
  }

  connect(): this {
    this.emit('packetsend', { cmd: 'connect', clientId: this.options.clientId ?? '' })
    return this
  }

  /** Simulates a CONNACK (success emits `connect`, a refusal emits `error`). */
  connack(fields: Partial<IConnackPacket> = {}): void {
    const packet: IConnackPacket = {
      cmd: 'connack',
      sessionPresent: false,
      reasonCode: 0,
      ...fields
    }
    this.emit('packetreceive', packet)
    if ((packet.reasonCode ?? packet.returnCode ?? 0) === 0) this.emit('connect', packet)
    else this.emit('error', new Error('Connection refused: (scripted)'))
  }

  /** Simulates the transport closing (mqtt.js emits `offline` first when it will reconnect). */
  drop(): void {
    if ((this.options.reconnectPeriod ?? 0) > 0) this.emit('offline')
    this.emit('close')
  }

  serverDisconnect(packet: Omit<IDisconnectPacket, 'cmd'>): void {
    const disconnect: IDisconnectPacket = { cmd: 'disconnect', ...packet }
    this.emit('packetreceive', disconnect)
    this.emit('disconnect', disconnect)
  }

  receive(packet: Omit<IPublishPacket, 'cmd'>): void {
    const publish: IPublishPacket = { cmd: 'publish', ...packet }
    this.emit('message', publish.topic, Buffer.from(publish.payload), publish)
  }

  subscribe(topic: string, options: IClientSubscribeOptions, callback: SubscribeCallback): this {
    this.subscribed.push({ topic, options })
    const code = this.subackCode
    setImmediate(() => {
      const packet: Packet = { cmd: 'suback', messageId: 1, granted: [code] }
      if (code >= 0x80) callback(new Error('Subscribe error'), [], packet)
      else callback(null, [{ topic, qos: code }], packet)
    })
    return this
  }

  unsubscribe(_topic: string, callback: PacketCallback): this {
    setImmediate(() => callback(undefined, { cmd: 'unsuback', messageId: 2, granted: [0] }))
    return this
  }

  publish(
    topic: string,
    payload: Buffer,
    options: IClientPublishOptions,
    callback: (err?: Error) => void
  ): this {
    this.published.push({ topic, payload, options })
    if (this.completePublishes) callback()
    return this
  }

  end(force?: boolean, _opts?: object, callback?: () => void): this {
    this.ended.push(force === true)
    this.disconnecting = true
    setImmediate(() => callback?.())
    return this
  }
}

/** A `ConnectFn` that records every fake client it creates. */
export function fakeConnector(): { connect: ConnectFn; clients: FakeMqttClient[] } {
  const clients: FakeMqttClient[] = []
  return {
    clients,
    connect: (url, options) => {
      const client = new FakeMqttClient(url, options)
      clients.push(client)
      // The fake implements the subset of MqttClient the session uses.
      return client as unknown as MqttClient
    }
  }
}
