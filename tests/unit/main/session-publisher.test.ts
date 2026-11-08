import type { MqttClient } from 'mqtt'
import { describe, expect, it, vi } from 'vitest'
import type { LogLevel, PublishRequest, QoS } from '@shared/models'
import { utf8Encode } from '@shared/payload'
import { SessionPublisher } from '../../../src/main/services/mqtt/session-publisher'

type Callback = (err?: Error | null) => void

/** The parts of mqtt.js the publisher relies on: outgoing store, last packet id, removal. */
class StoreClient {
  outgoing: Record<number, { volatile: boolean; cmd: string; cb: Callback }> = {}
  removed: number[] = []
  throwOnPublish: Error | null = null
  private lastId = 0

  publish(_topic: string, _payload: Buffer, options: { qos: QoS }, cb: Callback): this {
    if (options.qos > 0) {
      this.lastId += 1
      this.outgoing[this.lastId] = { volatile: false, cmd: 'publish', cb }
    }
    if (this.throwOnPublish) throw this.throwOnPublish
    return this
  }

  getLastMessageId(): number {
    return this.lastId
  }

  /** mqtt.js calls the stored callback with 'Message removed'. */
  removeOutgoingMessage(id: number): this {
    const entry = this.outgoing[id]
    delete this.outgoing[id]
    this.removed.push(id)
    entry?.cb(new Error('Message removed'))
    return this
  }

  ack(id: number): void {
    const entry = this.outgoing[id]
    delete this.outgoing[id]
    entry?.cb(null)
  }
}

function setup(): {
  publisher: SessionPublisher
  client: StoreClient
  logs: Array<[LogLevel, string]>
  failures: unknown[]
  send: (qos: QoS) => Promise<string>
} {
  const logs: Array<[LogLevel, string]> = []
  const failures: unknown[] = []
  const publisher = new SessionPublisher({
    connectionId: 'c1',
    protocolVersion: 5,
    ctx: { host: 'h', port: 1883 },
    log: (level, message) => logs.push([level, message]),
    pushMessage: vi.fn(),
    onWriteFailure: (err) => failures.push(err)
  })
  const client = new StoreClient()
  publisher.onConnected({})
  const request = (qos: QoS): PublishRequest => ({
    topic: 't',
    payload: utf8Encode('x'),
    qos,
    retain: false
  })
  const send = (qos: QoS): Promise<string> =>
    publisher.publish(client as unknown as MqttClient, request(qos)).then(
      () => 'ok',
      (err: Error) => err.message
    )
  return { publisher, client, logs, failures, send }
}

describe('SessionPublisher — broker DISCONNECT safety net', () => {
  it('drops unacknowledged QoS 1/2 publishes, but keeps QoS 2 messages the broker received', async () => {
    const { publisher, client, logs, send } = setup()
    const qos1 = send(1) // id 1
    const qos2Received = send(2) // id 2: PUBREC came, only PUBREL / PUBCOMP remain
    const qos2 = send(2) // id 3
    publisher.onPacket({ cmd: 'pubrec', messageId: 2, reasonCode: 0 })
    const reason = 'Disconnected by the broker: packet too large'
    publisher.onServerDisconnect(client as unknown as MqttClient, 0x95, reason)

    expect(await qos1).toBe(reason)
    expect(await qos2).toBe(reason)
    expect(client.removed).toEqual([1, 3])
    expect(logs).toContainEqual(['warn', 'The unacknowledged 2 messages are not sent again'])
    client.ack(2) // PUBCOMP after the reconnect
    expect(await qos2Received).toBe('ok')
  })

  it('keeps everything for a DISCONNECT that does not refuse a publish', async () => {
    const { publisher, client, send } = setup()
    const pending = send(1)
    publisher.onServerDisconnect(client as unknown as MqttClient, 0x8b, 'Server shutting down')
    expect(client.removed).toEqual([])
    client.ack(1)
    expect(await pending).toBe('ok')
  })

  it('takes a PUBLISH the writer failed on out of the store and reports the broken stream', async () => {
    const { client, failures, send } = setup()
    client.throwOnPublish = new TypeError('The "chunk" argument must be of type string')
    expect(await send(1)).toBe('The message could not be sent; the connection is reset')
    expect(client.removed).toEqual([1]) // never replayed after the reconnect
    expect(failures).toEqual([client.throwOnPublish])
  })
})
