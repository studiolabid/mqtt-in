/**
 * Subscription bookkeeping of one session: the subscriptions it should hold (restored after
 * reconnects), their live state, and the SUBSCRIBE / UNSUBSCRIBE round trips.
 *
 * After a CONNACK (`restore`): the first CONNACK of a session, or one without a resumed
 * session, subscribes every wanted subscription. A later CONNACK that resumed the session only
 * re-sends those without a recorded grant (refused, pending or never acknowledged), and every
 * resumed session drops the broker subscriptions this connection no longer wants
 * (`./stale-filters`). Subscriptions the broker announced it cannot take (wildcards, shared
 * subscriptions) fail locally, without a SUBSCRIBE that would get the client disconnected.
 */
import type { ISubscriptionGrant, MqttClient, Packet } from 'mqtt'
import type {
  LogLevel,
  MqttProtocolVersion,
  Subscription,
  SubscriptionEvent,
  SubscriptionState
} from '@shared/models'
import { validateTopicFilter } from '@shared/topic'
import { describeError, lowerFirst } from './reason-codes'
import { staleFilters, unsubscribeStale } from './stale-filters'
import {
  ackRefusal,
  firstAckCode,
  type SubscribeCapabilities,
  subscribeRequest,
  unsupportedSubscription
} from './subscription-rules'

type SubscriptionRef = Pick<Subscription, 'id' | 'topic'>

export interface SessionSubscriptionsDeps {
  connectionId: string
  protocolVersion: MqttProtocolVersion
  emit: (event: SubscriptionEvent) => void
  log: (level: LogLevel, message: string, detail?: string) => void
  /** Whether the session is still connected (results arriving after a drop are ignored). */
  isConnected: () => boolean
  /**
   * Filters the broker may hold for this connection, kept by the manager across sessions:
   * added on a granted SUBACK, removed on UNSUBACK, cleared when a CONNACK resumed nothing.
   */
  filters?: Set<string>
  /** Filters of the profile's disabled subscriptions (a resumed session may still hold them). */
  retired?: Iterable<string>
}

export class SessionSubscriptions {
  private readonly desired = new Map<string, Subscription>()
  private readonly states = new Map<string, SubscriptionEvent>()
  private readonly granted = new Map<string, number>()
  /** Bumped on every subscribe / unsubscribe so stale broker answers are ignored. */
  private readonly generations = new Map<string, number>()
  /**
   * The newest round trip per subscription, while in flight. An overtaken round trip resolves
   * with it (it decides the final state); mqtt.js always answers, with the ack or with
   * "Connection closed" once the socket goes away, so it settles too.
   */
  private readonly latest = new Map<string, Promise<SubscriptionEvent>>()
  private readonly filters: Set<string>
  private readonly retired: Set<string>
  /** What the broker's CONNACK announced (while connected; MQTT 5 only). */
  private capabilities: SubscribeCapabilities | undefined

  constructor(private readonly deps: SessionSubscriptionsDeps) {
    this.filters = deps.filters ?? new Set()
    this.retired = new Set(deps.retired)
  }

  /** Registers a subscription the session should hold (also after reconnects). */
  want(sub: Subscription): number {
    this.desired.set(sub.id, { ...sub })
    return this.bump(sub.id)
  }

  /** Forgets a subscription (it is no longer restored). */
  drop(subId: string): number {
    this.desired.delete(subId)
    return this.bump(subId)
  }

  /** A CONNACK: its capability flags apply until the connection closes. */
  onConnected(capabilities: SubscribeCapabilities | undefined): void {
    this.capabilities = this.deps.protocolVersion === 5 ? (capabilities ?? {}) : undefined
  }

  /**
   * Restores the subscriptions after a CONNACK: subscribes them all on the session's first
   * CONNACK or when the broker kept nothing, otherwise re-sends only those without a recorded
   * grant; a resumed session also drops the broker subscriptions no longer wanted.
   */
  restore(client: MqttClient, connack: { first: boolean; sessionPresent: boolean }): void {
    if (!connack.sessionPresent) {
      this.filters.clear() // a new broker session holds no subscription
    } else {
      const wanted = new Set([...this.desired.values()].map((sub) => sub.topic))
      const stale = staleFilters([...this.filters, ...this.retired], wanted)
      unsubscribeStale(client, stale, {
        log: this.deps.log,
        isConnected: this.deps.isConnected,
        removed: (filter) => {
          this.filters.delete(filter)
          this.retired.delete(filter)
        }
      })
    }
    const resumed = connack.sessionPresent && !connack.first
    for (const sub of this.desired.values()) {
      // The broker resumed the session: what it granted on this session before still holds.
      const grantedQos = resumed ? this.granted.get(sub.id) : undefined
      if (grantedQos !== undefined) this.set(sub, 'subscribed', { grantedQos })
      else void this.subscribe(client, sub, this.generation(sub.id))
    }
  }

  /** Every non-idle subscription becomes `idle`; the CONNACK capabilities are forgotten. */
  resetAll(): void {
    this.capabilities = undefined
    for (const event of [...this.states.values()]) {
      if (event.state !== 'idle') this.set({ id: event.subscriptionId, topic: event.topic }, 'idle')
    }
  }

  snapshot(): SubscriptionEvent[] {
    return [...this.states.values()].map((event) => ({ ...event }))
  }

  /**
   * SUBSCRIBE round trip. Resolves with the final state (`subscribed` / `failed` / `idle`);
   * when a newer request for the same subscription overtook it, with that request's result.
   * Fails locally (no packet) for an invalid filter or one the broker said it cannot take.
   */
  subscribe(client: MqttClient, sub: Subscription, generation: number): Promise<SubscriptionEvent> {
    // A grant counts once a SUBACK answered this round trip (MQ-11: never assume one).
    this.granted.delete(sub.id)
    const problem =
      validateTopicFilter(sub.topic) ?? unsupportedSubscription(sub.topic, this.capabilities)
    if (problem) {
      this.deps.log('error', `Cannot subscribe to ${sub.topic}: ${lowerFirst(problem)}`)
      return this.track(sub.id, Promise.resolve(this.set(sub, 'failed', { error: problem })))
    }
    const request = subscribeRequest(sub, this.deps.protocolVersion, this.capabilities)
    if (request.droppedIdentifier) {
      this.deps.log(
        'warn',
        `Subscribed to ${sub.topic} without its subscription identifier: the broker does not support them`
      )
    }
    const pending = this.set(sub, 'pending')
    const roundTrip = new Promise<SubscriptionEvent>((resolve) => {
      client.subscribe(sub.topic, request.options, (err, granted, packet) => {
        if (!this.isCurrent(sub.id, generation)) {
          resolve(this.latest.get(sub.id) ?? this.current(sub.id) ?? pending)
          return
        }
        resolve(this.applySuback(sub, err, granted, packet))
      })
    })
    return this.track(sub.id, roundTrip)
  }

  /**
   * UNSUBSCRIBE round trip. Resolves with the final state (`idle`, or `subscribed` if refused);
   * when a newer request for the same subscription overtook it, with that request's result.
   * Call `drop()` first. When another wanted subscription uses the same filter, the broker
   * subscription is kept (it serves both) and only this one becomes `idle`.
   */
  unsubscribe(
    client: MqttClient,
    sub: Subscription,
    generation: number
  ): Promise<SubscriptionEvent> {
    const shared = [...this.desired.values()].some(
      (other) => other.id !== sub.id && other.topic === sub.topic
    )
    if (shared) {
      this.deps.log('info', `Kept the subscription to ${sub.topic} (another subscription uses it)`)
      this.granted.delete(sub.id)
      return this.track(sub.id, Promise.resolve(this.set(sub, 'idle')))
    }
    const roundTrip = new Promise<SubscriptionEvent>((resolve) => {
      client.unsubscribe(sub.topic, (err?: Error, packet?: Packet) => {
        if (!this.isCurrent(sub.id, generation)) {
          resolve(this.latest.get(sub.id) ?? this.current(sub.id) ?? this.set(sub, 'idle'))
          return
        }
        resolve(this.applyUnsuback(sub, err, packet))
      })
    })
    return this.track(sub.id, roundTrip)
  }

  private applySuback(
    sub: Subscription,
    err: Error | null,
    granted: ISubscriptionGrant[] | undefined,
    packet: Packet | undefined
  ): SubscriptionEvent {
    if (!this.deps.isConnected()) return this.set(sub, 'idle')
    const code = err ? firstAckCode(packet) : granted?.[0]?.qos
    if (err || (code !== undefined && code >= 0x80)) {
      const refused = code !== undefined && code >= 0x80
      const reason = refused ? ackRefusal(code, this.deps.protocolVersion) : describeError(err)
      this.deps.log('error', `Subscribe to ${sub.topic} failed: ${lowerFirst(reason)}`)
      return this.set(sub, 'failed', { error: reason })
    }
    const grantedQos = code ?? sub.qos
    this.granted.set(sub.id, grantedQos)
    this.filters.add(sub.topic)
    this.deps.log(
      'info',
      grantedQos < sub.qos
        ? `Subscribed to ${sub.topic} (granted QoS ${grantedQos}, requested ${sub.qos})`
        : `Subscribed to ${sub.topic} (QoS ${grantedQos})`
    )
    return this.set(sub, 'subscribed', { grantedQos })
  }

  private applyUnsuback(sub: Subscription, err?: Error, packet?: Packet): SubscriptionEvent {
    if (err) {
      if (this.deps.isConnected()) {
        this.deps.log(
          'error',
          `Unsubscribe from ${sub.topic} failed: ${lowerFirst(describeError(err))}`
        )
      }
      return this.set(sub, 'idle')
    }
    const code = firstAckCode(packet)
    if (code !== undefined && code >= 0x80) {
      const reason = ackRefusal(code, this.deps.protocolVersion)
      this.deps.log('error', `Unsubscribe from ${sub.topic} refused: ${lowerFirst(reason)}`)
      return this.set(sub, 'subscribed', {
        grantedQos: this.granted.get(sub.id),
        error: `Unsubscribe refused: ${lowerFirst(reason)}`
      })
    }
    this.granted.delete(sub.id)
    this.filters.delete(sub.topic)
    this.retired.delete(sub.topic)
    this.deps.log(
      'info',
      code === 0x11
        ? `Unsubscribed from ${sub.topic} (no subscription existed)`
        : `Unsubscribed from ${sub.topic}`
    )
    return this.set(sub, 'idle')
  }

  private set(
    sub: SubscriptionRef,
    state: SubscriptionState,
    extra: { grantedQos?: number; error?: string } = {}
  ): SubscriptionEvent {
    const event: SubscriptionEvent = {
      connectionId: this.deps.connectionId,
      subscriptionId: sub.id,
      topic: sub.topic,
      state,
      timestamp: Date.now()
    }
    if (extra.grantedQos !== undefined) event.grantedQos = extra.grantedQos
    if (extra.error !== undefined) event.error = extra.error
    this.states.set(sub.id, event)
    this.deps.emit(event)
    return { ...event }
  }

  private current(subId: string): SubscriptionEvent | undefined {
    const event = this.states.get(subId)
    return event ? { ...event } : undefined
  }

  /** Remembers the newest round trip of a subscription (forgotten once it settled). */
  private track(subId: string, roundTrip: Promise<SubscriptionEvent>): Promise<SubscriptionEvent> {
    this.latest.set(subId, roundTrip)
    const forget = (): void => {
      if (this.latest.get(subId) === roundTrip) this.latest.delete(subId)
    }
    // Both handlers: the caller sees a failure, this bookkeeping branch must not.
    void roundTrip.then(forget, forget)
    return roundTrip
  }

  private generation(subId: string): number {
    return this.generations.get(subId) ?? 0
  }

  private bump(subId: string): number {
    const next = this.generation(subId) + 1
    this.generations.set(subId, next)
    return next
  }

  private isCurrent(subId: string, generation: number): boolean {
    return this.generation(subId) === generation
  }
}
