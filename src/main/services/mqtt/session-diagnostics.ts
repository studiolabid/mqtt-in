/**
 * Turns the low-level failures of one session (socket / TLS / WebSocket errors, refused
 * CONNACKs, broker DISCONNECTs) into human messages, logs them once and remembers the last one.
 * It also decides which failures end the session: CONNACK refusals and TLS errors retrying
 * cannot fix, a broker DISCONNECT that says so (another client took the session over, banned,
 * moved), and a broker that keeps disconnecting for the same reason (a reconnect loop).
 */
import type { IDisconnectPacket, Packet } from 'mqtt'
import type { MqttProtocol, MqttProtocolVersion } from '@shared/models'
import { errorCode, errorMessage } from '../../utils/errors'
import {
  connackErrorMessage,
  describeError,
  type ErrorContext,
  formatReasonCode,
  isFatalConnackCode,
  isFatalTransportError,
  isV3ConnackCode,
  lowerFirst,
  reasonCodeText,
  serverRedirectMessage
} from './reason-codes'
import type { SessionLog } from './session-log'

export interface ErrorOutcome {
  message: string
  /** Retrying cannot help (bad credentials, banned, certificate checks…): the session must stop. */
  fatal: boolean
}

/** This many broker DISCONNECTs with the same reason code within `windowMs` end auto-reconnect. */
export const REPEATED_DISCONNECT = { count: 3, windowMs: 30_000 } as const

const NOT_RETRYING = 'not retrying — fix the settings first'

/** Broker DISCONNECT reasons that end the session: reconnecting would only repeat them. */
const FINAL_DISCONNECTS: Readonly<
  Record<number, { message: (serverReference?: string) => string; why: string }>
> = {
  0x8a: {
    message: () => 'Disconnected by the broker: banned',
    why: 'the broker banned this client'
  },
  0x8e: {
    message: () => 'Another client connected with the same client ID',
    why: 'two clients with one client ID keep taking the session from each other'
  },
  0x9c: {
    message: (ref) => serverRedirectMessage(0x9c, ref),
    why: 'change the host of this connection'
  },
  0x9d: {
    message: (ref) => serverRedirectMessage(0x9d, ref),
    why: 'change the host of this connection'
  }
}

export interface ServerDisconnect {
  /** MQTT 5 reason code (0 = normal disconnection). */
  code: number
  /** e.g. `Disconnected by the broker: packet too large`. */
  message: string
  /** The broker refused the same way REPEATED_DISCONNECT.count times in a row. */
  repeated: boolean
  /** End the session without reconnecting (`repeated`, or a reason retrying cannot change). */
  final: boolean
}

interface Failure {
  err: unknown
  key: string
  outcome: ErrorOutcome
}

export class SessionDiagnostics {
  /** Human description of the last failure (cleared on CONNACK). */
  lastError: string | undefined
  private connackFailure: { code: number; reasonString?: string; serverReference?: string } | null =
    null
  /** A CONNACK arrived on the current network connection (until then resets get handshake hints). */
  private connackSeen = false
  /** The last error of the current attempt: mqtt.js emits some (TLS) errors twice. */
  private lastFailure: Failure | null = null
  private readonly watchedStreams = new WeakSet<object>()
  /** Broker DISCONNECTs of the last REPEATED_DISCONNECT.windowMs (kept across reconnects). */
  private recentDisconnects: Array<{ code: number; at: number }> = []

  constructor(
    private readonly version: MqttProtocolVersion,
    private readonly ctx: ErrorContext,
    private readonly log: SessionLog,
    private readonly protocol?: MqttProtocol
  ) {}

  /** A new connection attempt starts. */
  attemptStarted(): void {
    this.connackFailure = null
    this.connackSeen = false
    this.lastFailure = null
  }

  /** A CONNACK accepted the connection: the last failure is over. */
  connected(): void {
    this.connackFailure = null
    this.connackSeen = true
    this.lastFailure = null
    this.lastError = undefined
  }

  /** Remembers a refused CONNACK (mqtt.js reports it as a generic error right after). */
  inspectPacket(packet: Packet): void {
    if (packet.cmd !== 'connack') return
    this.connackSeen = true
    const code = (this.version === 5 ? packet.reasonCode : packet.returnCode) ?? 0
    const { reasonString, serverReference } = packet.properties ?? {}
    this.connackFailure = code > 0 ? { code, reasonString, serverReference } : null
  }

  /** Describes and logs an mqtt.js `error` event; a repeat within the attempt is not logged again. */
  onError(err: unknown): ErrorOutcome {
    const key = `${errorCode(err) ?? ''}|${errorMessage(err)}`
    const last = this.lastFailure
    if (last && (last.err === err || last.key === key)) return last.outcome
    const outcome = this.connackFailure ? this.connackRefused() : this.transportFailed(err)
    this.lastError = outcome.message
    this.lastFailure = { err, key, outcome }
    return outcome
  }

  /**
   * Logs an MQTT 5 DISCONNECT sent by the broker (the socket closes right after) and tells
   * whether the session must end: for a reason reconnecting cannot change (0x8a banned, 0x8e
   * session taken over, 0x9c / 0x9d another server), or a refusal (>= 0x80) seen
   * REPEATED_DISCONNECT.count times within REPEATED_DISCONNECT.windowMs, CONNACKs in between
   * included (a reconnect loop retrying cannot end).
   */
  onServerDisconnect(packet: IDisconnectPacket): ServerDisconnect {
    const code = packet.reasonCode ?? 0
    const reason = code === 0 ? 'Normal disconnection' : reasonCodeText(code)
    const { reasonString, serverReference } = packet.properties ?? {}
    const detail = [reasonString, serverReference && `server reference: ${serverReference}`]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' · ')
    this.log(
      'warn',
      `Disconnected by the broker: ${reason} (${formatReasonCode(code)})`,
      detail || undefined
    )
    const terminal = FINAL_DISCONNECTS[code]
    const message =
      terminal?.message(serverReference) ?? `Disconnected by the broker: ${lowerFirst(reason)}`
    this.lastError = message
    const repeated = code >= 0x80 && this.countRecent(code) >= REPEATED_DISCONNECT.count
    if (terminal) {
      this.log('error', message, `Not reconnecting: ${terminal.why}`)
    } else if (repeated) {
      const { count, windowMs } = REPEATED_DISCONNECT
      this.log(
        'error',
        `Not reconnecting: the broker disconnected ${count} times in ${windowMs / 1000} s for the same reason`
      )
    }
    return { code, message, repeated, final: repeated || terminal !== undefined }
  }

  /**
   * mqtt.js swallows transport errors without a `code` (e.g. a WebSocket handshake answered
   * with HTTP 404). Listening on each new stream gives those failures a human message too.
   */
  watchStream(stream: NodeJS.EventEmitter | undefined, isActive: () => boolean): void {
    if (!stream || this.watchedStreams.has(stream)) return
    this.watchedStreams.add(stream)
    stream.on('error', (err: Error) => {
      if (errorCode(err) || !isActive()) return
      this.lastError = describeError(err, this.errorContext())
      this.log('error', this.lastError, err.message !== this.lastError ? err.message : undefined)
    })
  }

  /** mqtt-packet threw half way through a packet: the connection is reset (logged). */
  onWriteFailure(err: unknown): void {
    this.lastError = 'A message could not be written; the connection was reset'
    this.log('error', this.lastError, errorMessage(err))
  }

  /** The reason to show for a connection that closed; logs a generic one when none is known. */
  closeReason(level: 'warn' | 'error' | null): string {
    if (this.lastError !== undefined) return this.lastError
    this.lastError = 'Connection closed by the broker'
    if (level) this.log(level, this.lastError)
    return this.lastError
  }

  private connackRefused(): ErrorOutcome {
    const failure = this.connackFailure ?? { code: 0 }
    this.connackFailure = null
    const { code, reasonString, serverReference } = failure
    const message = connackErrorMessage(code, this.version, reasonString, serverReference)
    const label = isV3ConnackCode(code, this.version)
      ? `${this.version === 5 ? 'MQTT 3.1.1 return' : 'Return'} code ${code}`
      : `Reason code ${formatReasonCode(code)}`
    const fatal = isFatalConnackCode(code, this.version)
    this.log('error', message, fatal ? `${label}; ${NOT_RETRYING}` : label)
    return { message, fatal }
  }

  private transportFailed(err: unknown): ErrorOutcome {
    const message = describeError(err, this.errorContext())
    const raw = errorMessage(err)
    const fatal = isFatalTransportError(err)
    const parts = [raw && raw !== message ? raw : '', fatal ? NOT_RETRYING : '']
    this.log('error', message, parts.filter((part) => part !== '').join('; ') || undefined)
    return { message, fatal }
  }

  private errorContext(): ErrorContext {
    return { ...this.ctx, protocol: this.protocol, connected: this.connackSeen }
  }

  /** Records a broker refusal; returns how often this code came within the window. */
  private countRecent(code: number): number {
    const now = Date.now()
    this.recentDisconnects = this.recentDisconnects.filter(
      (entry) => now - entry.at < REPEATED_DISCONNECT.windowMs
    )
    this.recentDisconnects.push({ code, at: now })
    return this.recentDisconnects.filter((entry) => entry.code === code).length
  }
}
