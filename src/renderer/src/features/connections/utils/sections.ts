/**
 * Sections of the connection dialog (left navigation), in display order.
 */
import type { Component } from 'vue'
import {
  KeyRoundIcon,
  LayersIcon,
  MessageSquareWarningIcon,
  ServerIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon
} from '@lucide/vue'

export type FormSectionId = 'general' | 'auth' | 'tls' | 'advanced' | 'will' | 'mqtt5'

export interface FormSection {
  id: FormSectionId
  label: string
  icon: Component
  /** One line shown under the section title. */
  description: string
}

export const FORM_SECTIONS: readonly FormSection[] = [
  {
    id: 'general',
    label: 'General',
    icon: ServerIcon,
    description: 'Broker address, identity and protocol version.'
  },
  {
    id: 'auth',
    label: 'Authentication',
    icon: KeyRoundIcon,
    description: 'Credentials sent with CONNECT. Leave both empty for anonymous access.'
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
    description: 'A message the broker publishes when this client disconnects unexpectedly.'
  },
  {
    id: 'mqtt5',
    label: 'MQTT 5',
    icon: LayersIcon,
    description: 'CONNECT properties for MQTT 5.0 brokers. Empty fields are not sent.'
  }
]
