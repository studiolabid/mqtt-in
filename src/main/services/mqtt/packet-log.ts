/**
 * Debug-level log lines for MQTT control packets (`packetsend` / `packetreceive`).
 *
 * PUBLISH and its acknowledgements are skipped (they would flood the log; messages are
 * visible in the message stream). Passwords are never logged.
 */
import type { Packet } from 'mqtt'

export type PacketDirection = 'in' | 'out'

export interface PacketLogLine {
  message: string
  detail?: string
}

const SKIPPED = new Set<Packet['cmd']>(['publish', 'puback', 'pubrec', 'pubrel', 'pubcomp'])
const MAX_STRING = 300

/** JSON replacer: binary → `<n bytes>`, long strings truncated, null-prototype maps kept. */
function compact(this: unknown, key: string, value: unknown): unknown {
  const raw: unknown =
    typeof this === 'object' && this !== null ? (this as Record<string, unknown>)[key] : value
  if (raw instanceof Uint8Array) return `<${raw.byteLength} bytes>`
  if (typeof value === 'string' && value.length > MAX_STRING) {
    return `${value.slice(0, MAX_STRING)}…`
  }
  return value
}

function stringify(detail: Record<string, unknown>): string | undefined {
  const json = JSON.stringify(detail, compact)
  return json === '{}' ? undefined : json
}

function packetDetail(packet: Packet): Record<string, unknown> {
  switch (packet.cmd) {
    case 'connect':
      return {
        clientId: packet.clientId,
        protocolId: packet.protocolId,
        protocolVersion: packet.protocolVersion,
        clean: packet.clean,
        keepalive: packet.keepalive,
        username: packet.username,
        password: packet.password !== undefined ? '******' : undefined,
        will: packet.will
          ? {
              topic: packet.will.topic,
              qos: packet.will.qos,
              retain: packet.will.retain,
              payload: packet.will.payload,
              properties: packet.will.properties
            }
          : undefined,
        properties: packet.properties
      }
    case 'connack':
      return {
        sessionPresent: packet.sessionPresent,
        returnCode: packet.returnCode,
        reasonCode: packet.reasonCode,
        properties: packet.properties
      }
    case 'subscribe':
      return {
        messageId: packet.messageId,
        subscriptions: packet.subscriptions,
        properties: packet.properties
      }
    case 'suback':
    case 'unsuback':
      return { messageId: packet.messageId, granted: packet.granted, properties: packet.properties }
    case 'unsubscribe':
      return {
        messageId: packet.messageId,
        unsubscriptions: packet.unsubscriptions,
        properties: packet.properties
      }
    case 'disconnect':
    case 'auth':
      return { reasonCode: packet.reasonCode, properties: packet.properties }
    default:
      return {}
  }
}

/** A log line for a control packet, or `null` for packets that are not logged. */
export function describePacket(packet: Packet, direction: PacketDirection): PacketLogLine | null {
  if (SKIPPED.has(packet.cmd)) return null
  const arrow = direction === 'out' ? '→' : '←'
  const line: PacketLogLine = { message: `${arrow} ${packet.cmd.toUpperCase()}` }
  const detail = stringify(packetDetail(packet))
  if (detail) line.detail = detail
  return line
}
