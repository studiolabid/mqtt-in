/**
 * Ready-made connection presets (quick start cards, command palette, connection dialog).
 * Pass `preset.profile` to `useUiStore().openNewConnection(...)`; `connections.create()` fills
 * every missing field and gives the profile and its subscriptions fresh ids.
 */
import type { ConnectionProfile } from '@shared/models'
import { createSubscription } from '@shared/defaults'

export interface BrokerPreset {
  id: string
  /** Card title. */
  title: string
  /** One-line description. */
  description: string
  /** Display address, e.g. `broker.emqx.io:1883`. */
  address: string
  profile: Partial<ConnectionProfile>
}

/** `mqtt-in/#` makes the quick start useful: publish to `mqtt-in/test` and see it arrive. */
const demoSubscriptions = (): ConnectionProfile['subscriptions'] => [
  createSubscription({ topic: 'mqtt-in/#', qos: 0 })
]

export const BROKER_PRESETS: readonly BrokerPreset[] = [
  {
    id: 'emqx',
    title: 'EMQX',
    description: 'Free public MQTT 5 broker by EMQ',
    address: 'broker.emqx.io:1883',
    profile: {
      name: 'EMQX public',
      protocol: 'mqtt',
      host: 'broker.emqx.io',
      port: 1883,
      protocolVersion: 5,
      subscriptions: demoSubscriptions()
    }
  },
  {
    id: 'emqx-wss',
    title: 'EMQX over WebSocket',
    description: 'Same broker through secure WebSocket (TLS)',
    address: 'wss://broker.emqx.io:8084/mqtt',
    profile: {
      name: 'EMQX public (WSS)',
      protocol: 'wss',
      host: 'broker.emqx.io',
      port: 8084,
      path: '/mqtt',
      protocolVersion: 5,
      subscriptions: demoSubscriptions()
    }
  },
  {
    id: 'hivemq',
    title: 'HiveMQ',
    description: 'Public HiveMQ broker for testing',
    address: 'broker.hivemq.com:1883',
    profile: {
      name: 'HiveMQ public',
      protocol: 'mqtt',
      host: 'broker.hivemq.com',
      port: 1883,
      protocolVersion: 5,
      subscriptions: demoSubscriptions()
    }
  },
  {
    id: 'mosquitto',
    title: 'Eclipse Mosquitto',
    description: 'Public test server of the Mosquitto project',
    address: 'test.mosquitto.org:1883',
    profile: {
      name: 'Mosquitto test',
      protocol: 'mqtt',
      host: 'test.mosquitto.org',
      port: 1883,
      protocolVersion: 5,
      subscriptions: demoSubscriptions()
    }
  },
  {
    id: 'local',
    title: 'Local broker',
    description: 'A broker running on this machine',
    address: 'localhost:1883',
    profile: {
      name: 'Local broker',
      protocol: 'mqtt',
      host: 'localhost',
      port: 1883,
      protocolVersion: 5,
      subscriptions: [createSubscription({ topic: '#', qos: 0 })]
    }
  }
]
