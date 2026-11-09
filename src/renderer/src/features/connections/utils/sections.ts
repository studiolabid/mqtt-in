/**
 * Sections of the connection dialog (left navigation), in display order. Some only apply to
 * one connection kind (`kinds`): Authentication, Last Will and MQTT 5 to MQTT, Socket to
 * WebSocket and Socket.IO.
 */
import type { Component } from 'vue'
import type { ConnectionKind } from '@shared/models'
import {
  CableIcon,
  KeyRoundIcon,
  LayersIcon,
  MessageSquareWarningIcon,
  ServerIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon
} from '@lucide/vue'

export type FormSectionId = 'general' | 'socket' | 'auth' | 'tls' | 'advanced' | 'will' | 'mqtt5'

export interface FormSection {
  id: FormSectionId
  label: string
  icon: Component
  /** One line shown under the section title. */
  description: string
  /** The connection kinds that show the section (all when missing). */
  kinds?: readonly ConnectionKind[]
}

export const FORM_SECTIONS: readonly FormSection[] = [
  {
    id: 'general',
    label: 'General',
    icon: ServerIcon,
    description: 'Connection type, address and identity.'
  },
  {
    id: 'socket',
    label: 'Socket',
    icon: CableIcon,
    description: 'Handshake headers and the options of WebSocket and Socket.IO servers.',
    kinds: ['websocket', 'socketio']
  },
  {
    id: 'auth',
    label: 'Authentication',
    icon: KeyRoundIcon,
    description: 'Credentials sent with CONNECT. Leave both empty for anonymous access.',
    kinds: ['mqtt']
  },
  {
    id: 'tls',
    label: 'TLS/SSL',
    icon: ShieldCheckIcon,
    description: 'Encryption, certificates and verification for mqtts:// and wss://.'
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: SlidersHorizontalIcon,
    description: 'Session, keep alive and reconnect behavior.'
  },
  {
    id: 'will',
    label: 'Last Will',
    icon: MessageSquareWarningIcon,
    description: 'A message the broker publishes when this client disconnects unexpectedly.',
    kinds: ['mqtt']
  },
  {
    id: 'mqtt5',
    label: 'MQTT 5',
    icon: LayersIcon,
    description: 'CONNECT properties for MQTT 5.0 brokers. Empty fields are not sent.',
    kinds: ['mqtt']
  }
]

/** The sections a connection kind shows, in display order. */
export function sectionsFor(kind: ConnectionKind): readonly FormSection[] {
  return FORM_SECTIONS.filter((section) => !section.kinds || section.kinds.includes(kind))
}
