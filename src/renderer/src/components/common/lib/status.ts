import type { ConnectionStatus } from '@shared/models'

/** Human labels for every connection status. */
export const CONNECTION_STATUS_LABELS: Readonly<Record<ConnectionStatus, string>> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnecting: 'Disconnecting…',
  error: 'Error',
  disconnected: 'Disconnected'
}

/** Semantic color family of a status (maps to the `success` / `warning` / … theme tokens). */
export type StatusTone = 'success' | 'warning' | 'destructive' | 'muted'

const TONES: Readonly<Record<ConnectionStatus, StatusTone>> = {
  connected: 'success',
  connecting: 'warning',
  reconnecting: 'warning',
  disconnecting: 'warning',
  error: 'destructive',
  disconnected: 'muted'
}

/** Color family for a status (unknown values are `muted`). */
export function statusTone(status: ConnectionStatus): StatusTone {
  return TONES[status] ?? 'muted'
}

/**
 * Shape of a status glyph, so the state reads without color too (grayscale, color vision
 * deficiencies, Windows High Contrast; A11Y-18): a filled dot when connected, a hollow ring when
 * disconnected, a ring with a pulse while changing state, an alert triangle on error.
 */
export type StatusGlyph = 'filled' | 'ring' | 'pulse' | 'alert'

const GLYPHS: Readonly<Record<ConnectionStatus, StatusGlyph>> = {
  connected: 'filled',
  connecting: 'pulse',
  reconnecting: 'pulse',
  disconnecting: 'pulse',
  error: 'alert',
  disconnected: 'ring'
}

/** Glyph shape for a status (unknown values are a `ring`, like disconnected). */
export function statusGlyph(status: ConnectionStatus): StatusGlyph {
  return GLYPHS[status] ?? 'ring'
}

/** True while the session is changing state (connecting, reconnecting, disconnecting). */
export function isTransitionalStatus(status: ConnectionStatus): boolean {
  return statusTone(status) === 'warning'
}

/** Label for a status (falls back to the raw value). */
export function connectionStatusLabel(status: ConnectionStatus): string {
  return CONNECTION_STATUS_LABELS[status] ?? status
}
