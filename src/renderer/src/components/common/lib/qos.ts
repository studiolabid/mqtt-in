import type { QoS } from '@shared/models'

/** Display metadata for one MQTT QoS level. */
export interface QosLevel {
  value: QoS
  /** Short name, e.g. `At least once`. */
  label: string
  /** One sentence for tooltips and help text. */
  description: string
}

/** The three MQTT delivery guarantees, in level order. */
export const QOS_LEVELS: readonly QosLevel[] = [
  {
    value: 0,
    label: 'At most once',
    description: 'Fire and forget. No acknowledgement, the message may be lost.'
  },
  {
    value: 1,
    label: 'At least once',
    description: 'Acknowledged with PUBACK. Always delivered, duplicates are possible.'
  },
  {
    value: 2,
    label: 'Exactly once',
    description: 'Four-step handshake. Delivered exactly once, never duplicated.'
  }
]

/** Metadata for a level; unknown values fall back to QoS 0. */
export function qosLevel(qos: QoS): QosLevel {
  return QOS_LEVELS[qos] ?? QOS_LEVELS[0]
}

/** Narrows an arbitrary value to a QoS level, or `null`. */
export function toQos(value: unknown): QoS | null {
  const n = typeof value === 'string' ? Number(value) : value
  return n === 0 || n === 1 || n === 2 ? n : null
}
