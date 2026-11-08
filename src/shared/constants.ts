/**
 * App-wide constants: identity, the color palette, default ports, protocol labels, default
 * settings and the hard limits. Import them from `@shared/defaults` (which re-exports this file).
 * Pure, no runtime dependencies.
 */
import type { AppSettings, MqttProtocol, MqttProtocolVersion } from './models'

export const APP_NAME = 'mqtey'

/** The studio behind mqtey (the "Powered by" credit). */
export const APP_VENDOR = { name: 'studiolab.id', url: 'https://studiolab.id' } as const

/** Neutral gray that reads on light and dark: the default color, matching the monochrome look. */
export const NEUTRAL_COLOR = '#71717a'

/**
 * Colors for connection avatars and subscription tags: the neutral default first, then vivid,
 * theme-agnostic colors for telling several connections or subscriptions apart.
 */
export const PALETTE = [
  NEUTRAL_COLOR, // gray
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#ef4444', // red
  '#8b5cf6', // violet
  '#84cc16', // lime
  '#6366f1' // indigo
] as const

export const DEFAULT_PORTS: Record<MqttProtocol, number> = {
  mqtt: 1883,
  mqtts: 8883,
  ws: 8083,
  wss: 8084
}

const PROTOCOL_LABELS: Readonly<Record<MqttProtocolVersion, string>> = {
  3: 'MQTT 3.1',
  4: 'MQTT 3.1.1',
  5: 'MQTT 5.0'
}

/** The protocol versions in picker order (newest first). */
export const PROTOCOL_VERSIONS: { value: MqttProtocolVersion; label: string }[] = (
  [5, 4, 3] as const
).map((value) => ({ value, label: PROTOCOL_LABELS[value] }))

/** `MQTT 3.1`, `MQTT 3.1.1` or `MQTT 5.0` (`MQTT <n>` for an unknown value from old data). */
export function protocolLabel(version: MqttProtocolVersion): string {
  return PROTOCOL_LABELS[version] ?? `MQTT ${String(version)}`
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  // Black and white (the base palette); colored accents are opt-in in Settings.
  accent: 'zinc',
  maxMessagesPerConnection: 10_000,
  defaultViewFormat: 'auto',
  timestampFormat: 'time',
  showMilliseconds: true,
  autoScroll: true,
  wordWrap: true,
  confirmBeforeDelete: true
}

/**
 * Hard limits shared by validation on both sides of the IPC boundary: the connection form, the
 * main-process schemas and the mqtt.js client options use these, never their own literals.
 */
export const LIMITS = {
  maxMessagesPerConnection: { min: 100, max: 200_000 },
  repeatIntervalMs: { min: 10, max: 24 * 60 * 60 * 1000 },
  maxOpenFileBytes: 32 * 1024 * 1024,
  maxTopicBytes: 65_535,
  /** Delay between reconnect attempts while auto reconnect is on (faster floods the broker). */
  reconnectPeriodMs: { min: 100, max: 86_400_000 },
  /** CONNACK timeout; 0 = the client's default. */
  connectTimeoutMs: { min: 0, max: 3_600_000 },
  /** Keep alive in seconds; 0 = off. */
  keepaliveS: { min: 0, max: 65_535 }
} as const
