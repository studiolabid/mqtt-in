/**
 * Per-session building blocks: the log function and the message records sent to the UI.
 */
import type { IPublishPacket } from 'mqtt'
import type {
  LogEntry,
  LogLevel,
  MqttMessage,
  MqttProtocolVersion,
  PublishRequest
} from '@shared/models'
import { toOwnedBytes } from '../../utils/bytes'
import { nextLogId, nextMessageId } from './ids'
import { fromPublishPacketProperties, type PublishPacketProperties } from './properties'

/** Appends an entry to a connection's log. */
export type SessionLog = (level: LogLevel, message: string, detail?: string) => void

/** A `SessionLog` that emits `LogEntry`s with process-wide ids. */
export function createSessionLog(
  connectionId: string,
  emit: (entry: LogEntry) => void
): SessionLog {
  return (level, message, detail) => {
    const entry: LogEntry = {
      id: nextLogId(),
      connectionId,
      level,
      message,
      timestamp: Date.now()
    }
    if (detail) entry.detail = detail
    emit(entry)
  }
}

/** A received PUBLISH as an `in` message (payload copied, MQTT 5 properties converted). */
export function incomingMessage(
  connectionId: string,
  protocolVersion: MqttProtocolVersion,
  topic: string,
  payload: Buffer,
  packet: IPublishPacket
): MqttMessage {
  const message: MqttMessage = {
    id: nextMessageId(),
    connectionId,
    direction: 'in',
    topic,
    // Copy: pooled Node buffers would otherwise be serialized whole over IPC.
    payload: new Uint8Array(payload),
    qos: packet.qos,
    retain: packet.retain,
    dup: packet.dup,
    timestamp: Date.now()
  }
  if (protocolVersion === 5) {
    const properties = fromPublishPacketProperties(packet.properties)
    if (properties) message.properties = properties
  }
  return message
}

/**
 * A publish handed to mqtt.js as an `out` message (CT-27). `timestamp` is the hand-off time;
 * the id is allocated now, so it orders before the broker's answer and any echo.
 */
export function outgoingMessage(
  connectionId: string,
  request: PublishRequest,
  packetProperties: PublishPacketProperties | undefined,
  timestamp: number
): MqttMessage {
  const message: MqttMessage = {
    id: nextMessageId(),
    connectionId,
    direction: 'out',
    topic: request.topic,
    payload: toOwnedBytes(request.payload),
    qos: request.qos,
    retain: request.retain,
    dup: false,
    timestamp
  }
  const properties = fromPublishPacketProperties(packetProperties)
  if (properties) message.properties = properties
  return message
}
