/**
 * Runtime lists of the string unions from `@shared/models`.
 *
 * Each list is built from a record keyed by the union, so the compiler fails when a
 * member is added to (or removed from) the model without updating validation.
 */
import type {
  AccentColor,
  MqttProtocol,
  PayloadFormat,
  ThemeMode,
  TimestampFormat,
  ViewFormat
} from '@shared/models'

/** Keys of a record that must name every member of `T` exactly once. */
function membersOf<T extends string>(record: Record<T, true>): [T, ...T[]] {
  return Object.keys(record) as [T, ...T[]]
}

export const MQTT_PROTOCOLS = membersOf<MqttProtocol>({
  mqtt: true,
  mqtts: true,
  ws: true,
  wss: true
})

export const PAYLOAD_FORMATS = membersOf<PayloadFormat>({
  text: true,
  json: true,
  hex: true,
  base64: true,
  msgpack: true,
  cbor: true
})

export const VIEW_FORMATS = membersOf<ViewFormat>({
  auto: true,
  text: true,
  json: true,
  hex: true,
  base64: true,
  msgpack: true,
  cbor: true
})

export const THEME_MODES = membersOf<ThemeMode>({ system: true, light: true, dark: true })

export const ACCENT_COLORS = membersOf<AccentColor>({
  zinc: true,
  violet: true,
  blue: true,
  emerald: true,
  cyan: true,
  amber: true,
  orange: true,
  rose: true
})

export const TIMESTAMP_FORMATS = membersOf<TimestampFormat>({
  time: true,
  datetime: true,
  relative: true
})
