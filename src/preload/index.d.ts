import type { MqttInApi } from '../shared/ipc'

declare global {
  interface Window {
    /** Typed bridge from the preload script. Use `@/services/api` instead of this directly. */
    mqttIn: MqttInApi
  }
}

export {}
