/**
 * Wire limits of MQTT strings and binary fields, checked before mqtt.js writes a packet:
 * mqtt-packet throws half way through a packet for a field over 65,535 bytes (the header and
 * topic are already on the socket), which wedges the connection. Throws a human error such as
 * `Content type is too long (max 65535 bytes)`.
 */
import type { UserProperty } from '@shared/models'
import { MQTT_STRING_MAX_BYTES, mqttStringProblem, utf8ByteLength } from '@shared/mqtt-string'

/** An MQTT UTF-8 string: at most 65,535 bytes, no unpaired surrogate. */
export function assertMqttString(value: string | undefined, label: string): void {
  if (value === undefined) return
  const problem = mqttStringProblem(value)
  if (problem) throw new Error(`${label} ${problem}`)
}

/** MQTT binary data (password, correlation data, will message): at most 65,535 bytes. */
export function assertMqttBinary(value: string | Uint8Array | undefined, label: string): void {
  if (value === undefined) return
  const bytes = typeof value === 'string' ? utf8ByteLength(value) : value.byteLength
  if (bytes > MQTT_STRING_MAX_BYTES) {
    throw new Error(`${label} is too long (max ${MQTT_STRING_MAX_BYTES} bytes)`)
  }
}

/** Keys and values of user properties (entries with an empty key are never sent). */
export function assertUserProperties(
  list: readonly UserProperty[] | undefined,
  label = 'User property'
): void {
  for (const { key, value } of list ?? []) {
    if (key === '') continue
    assertMqttString(key, `${label} key`)
    assertMqttString(value, `${label} value`)
  }
}
