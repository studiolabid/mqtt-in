/**
 * Publishing for one session:
 * - local checks first (`assertPublishable`: MQTT string sizes and the broker's CONNACK limits:
 *   retain, Maximum QoS, topic aliases, Maximum Packet Size), so a publish the broker would
 *   answer with a DISCONNECT is refused with a human error and never reaches the wire;
 * - outbound flow control (`SendQuota`): at most Receive Maximum QoS 1/2 publishes wait for
 *   their acknowledgement, later ones queue in FIFO order;
 * - the `out` message, recorded when the PUBLISH is handed to mqtt.js (CT-27): before the
 *   broker's answer or echo, so the stream stays in order; a later failure still rejects;
 * - in-flight tracking, so callers never wait forever on a dead connection;
 * - recovery: QoS 1/2 publishes the broker refused by disconnecting are removed from mqtt.js's
 *   store (it would resend them after every reconnect), and a PUBLISH mqtt-packet failed to
 *   write marks the connection broken.
 */
import type { IClientPublishOptions, MqttClient, Packet } from 'mqtt'
import type { MqttMessage, MqttProtocolVersion, PublishRequest, QoS } from '@shared/models'
import { toPublishPacketProperties, type PublishPacketProperties } from './properties'
import { assertPublishable, type BrokerLimits } from './publish-checks'
import { describeError, type ErrorContext, lowerFirst } from './reason-codes'
import { SendQuota } from './send-quota'
import { outgoingMessage, type SessionLog } from './session-log'

/**
 * Broker DISCONNECT reasons caused by a PUBLISH: topic name or alias invalid, packet too large,
 * quota exceeded, payload format invalid, retain or QoS not supported.
 */
const PUBLISH_REFUSALS = new Set([0x90, 0x94, 0x95, 0x97, 0x99, 0x9a, 0x9b])

export interface SessionPublisherDeps {
  connectionId: string
  protocolVersion: MqttProtocolVersion
  ctx: ErrorContext
  log: SessionLog
  pushMessage: (message: MqttMessage) => void
  /** mqtt-packet threw while writing a PUBLISH: the socket holds part of a packet. */
  onWriteFailure: (err: unknown) => void
}

interface Pending {
  qos: QoS
  /** Handed to mqtt.js; a QoS 1/2 one holds a send-quota slot until it settles. */
  sent: boolean
  /** QoS 2 acknowledged with PUBREC: the broker has the message, only PUBREL remains. */
  received: boolean
  /** Resolved or rejected (later callbacks are ignored). */
  settled: boolean
  /** Rejected: mqtt.js refused it right away, or the broker / connection failed it later. */
  failed: boolean
  /** mqtt.js packet identifier of a QoS 1/2 publish, once known. */
  messageId?: number
  /** Removes a publish still waiting for a send-quota slot from the queue. */
  cancelWait: () => void
  /** The callback mqtt.js gets. */
  callback: (err?: Error) => void
  settle: (err?: Error | null) => void
}

const noop = (): void => {}

export class SessionPublisher {
  private readonly pending = new Set<Pending>()
  /** Sent QoS 1/2 publishes by mqtt.js packet identifier. */
  private readonly byId = new Map<number, Pending>()
  private readonly quota = new SendQuota()
  /** CONNACK properties while connected (`{}` when the broker announced none). */
  private limits: BrokerLimits | undefined

  constructor(private readonly deps: SessionPublisherDeps) {}

  /** The broker's Receive Maximum (65,535 when not announced): QoS 1/2 publishes in flight. */
  get receiveMaximum(): number {
    return this.quota.limit
  }

  /** A CONNACK: its limits apply from now on and queued publishes may start. */
  onConnected(props: BrokerLimits | undefined): void {
    this.limits = props ?? {}
    this.quota.open(props?.receiveMaximum, this.unacknowledged().length)
  }

  /**
   * The connection closed while mqtt.js reconnects: QoS 0 publishes wait for a 'drain' that never
   * comes and queued publishes were never handed over, so both fail with `err`. Unacknowledged
   * QoS 1/2 publishes stay: mqtt.js resends them after the reconnect.
   */
  onClosed(err: Error): void {
    this.limits = undefined
    this.quota.close()
    for (const entry of [...this.pending]) {
      if (entry.qos === 0 || !entry.sent) entry.settle(err)
    }
  }

  /** Rejects every publish still pending (the session ends). */
  rejectPending(err: Error): void {
    this.limits = undefined
    this.quota.close()
    for (const entry of [...this.pending]) entry.settle(err)
  }

  /** Incoming control packets: a PUBREC means the broker has that QoS 2 message. */
  onPacket(packet: Packet): void {
    if (packet.cmd !== 'pubrec' || (packet.reasonCode ?? 0) >= 0x80) return
    const entry = packet.messageId === undefined ? undefined : this.byId.get(packet.messageId)
    if (entry) entry.received = true
  }

  /** Throws the human reason `request` cannot be published on this connection right now. */
  check(request: PublishRequest): void {
    assertPublishable(request, this.packetProperties(request), this.limits, this.version)
  }

  /**
   * Publishes `request`; the `out` message is emitted once it is handed to mqtt.js. Rejects
   * with a human error (also logged) when a local check fails (no `out` message then), the
   * broker refuses or the connection goes away.
   */
  async publish(client: MqttClient, request: PublishRequest): Promise<void> {
    const properties = this.packetProperties(request)
    const options: IClientPublishOptions = { qos: request.qos, retain: request.retain }
    if (properties) options.properties = properties
    try {
      assertPublishable(request, properties, this.limits, this.version)
      await this.send(client, request, options)
    } catch (err) {
      const message = describeError(err, this.deps.ctx)
      this.deps.log('error', `Publish to ${request.topic} failed: ${lowerFirst(message)}`)
      throw new Error(message, { cause: err })
    }
  }

  /**
   * A broker DISCONNECT. When its reason refuses a PUBLISH (PUBLISH_REFUSALS), mqtt.js would
   * resend the unacknowledged QoS 1/2 publishes after the reconnect and be disconnected again,
   * forever: they are removed from its store and rejected with `reason`. QoS 2 messages the
   * broker already received (PUBREC) are kept.
   */
  onServerDisconnect(client: MqttClient, code: number, reason: string): void {
    if (!PUBLISH_REFUSALS.has(code)) return
    this.quota.close() // the connection is going away: start nothing more on it
    const dropped = this.unacknowledged().filter((entry) => !entry.received)
    for (const entry of dropped) {
      const id = entry.messageId ?? outgoingIdOf(client, entry.callback)
      entry.settle(new Error(reason))
      if (id !== undefined) client.removeOutgoingMessage(id)
    }
    if (dropped.length === 0) return
    const what = dropped.length === 1 ? 'message is' : `${dropped.length} messages are`
    this.deps.log('warn', `The unacknowledged ${what} not sent again`)
  }

  private get version(): MqttProtocolVersion {
    return this.deps.protocolVersion
  }

  private packetProperties(request: PublishRequest): PublishPacketProperties | undefined {
    return this.version === 5 ? toPublishPacketProperties(request.properties) : undefined
  }

  private unacknowledged(): Pending[] {
    return [...this.pending].filter((entry) => entry.sent && entry.qos > 0)
  }

  private send(
    client: MqttClient,
    request: PublishRequest,
    options: IClientPublishOptions
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const entry: Pending = {
        qos: request.qos,
        sent: false,
        received: false,
        settled: false,
        failed: false,
        cancelWait: noop,
        callback: (err) => entry.settle(err),
        settle: (err) => {
          if (entry.settled) return
          entry.settled = true
          entry.failed = Boolean(err)
          this.pending.delete(entry)
          if (entry.messageId !== undefined && this.byId.get(entry.messageId) === entry) {
            this.byId.delete(entry.messageId)
          }
          entry.cancelWait()
          if (entry.sent && entry.qos > 0) this.quota.release()
          if (err) reject(err)
          else resolve()
        }
      }
      this.pending.add(entry)
      const start = (): void => this.handOff(client, request, options, entry)
      if (entry.qos === 0) start()
      else entry.cancelWait = this.quota.acquire(start)
    })
  }

  /**
   * The one place a PUBLISH is handed to mqtt.js: after the local checks passed and, for QoS
   * 1/2, once a send-quota slot is free. Records the `out` message right away (CT-27): its id
   * and time precede the broker's answer and any echo of a subscription, which mqtt.js can only
   * report later. A publish mqtt.js refuses on the spot (or fails to write) gets none.
   */
  private handOff(
    client: MqttClient,
    request: PublishRequest,
    options: IClientPublishOptions,
    entry: Pending
  ): void {
    entry.sent = true
    const timestamp = Date.now()
    try {
      client.publish(request.topic, Buffer.from(request.payload), options, entry.callback)
    } catch (err) {
      // mqtt-packet threw half way through the packet: what is on the socket is garbage now.
      this.quota.close()
      const id = entry.qos > 0 ? outgoingIdOf(client, entry.callback) : undefined
      entry.settle(
        new Error('The message could not be sent; the connection is reset', { cause: err })
      )
      if (id !== undefined) client.removeOutgoingMessage(id) // never resent after the reconnect
      this.deps.onWriteFailure(err)
      return
    }
    if (!entry.failed) {
      const { connectionId, pushMessage } = this.deps
      pushMessage(outgoingMessage(connectionId, request, options.properties, timestamp))
    }
    if (entry.qos === 0 || entry.settled) return
    entry.messageId = outgoingIdOf(client, entry.callback)
    if (entry.messageId !== undefined) this.byId.set(entry.messageId, entry)
  }
}

/** mqtt.js's packet identifier of the QoS 1/2 publish whose callback is `callback`. */
function outgoingIdOf(client: MqttClient, callback: (err?: Error) => void): number | undefined {
  const outgoing = client.outgoing ?? {}
  const last = client.getLastMessageId?.()
  if (last !== undefined && outgoing[last]?.cb === callback) return last
  for (const key of Object.keys(outgoing)) {
    if (outgoing[Number(key)]?.cb === callback) return Number(key)
  }
  return undefined
}
