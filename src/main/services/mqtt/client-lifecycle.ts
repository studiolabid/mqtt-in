/**
 * Small helpers around the mqtt.js client lifecycle.
 */
import type { MqttClient, MqttClientEventCallbacks } from 'mqtt'

export type ClientHandlers = { [E in keyof MqttClientEventCallbacks]?: MqttClientEventCallbacks[E] }

/** Adds the handlers to `client`; the returned function removes exactly those handlers. */
export function listenTo(client: MqttClient, handlers: ClientHandlers): () => void {
  const removers: Array<() => void> = []
  const add = <E extends keyof MqttClientEventCallbacks>(
    event: E,
    handler: MqttClientEventCallbacks[E] | undefined
  ): void => {
    if (!handler) return
    client.on(event, handler)
    removers.push(() => client.off(event, handler))
  }
  for (const event of Object.keys(handlers) as (keyof MqttClientEventCallbacks)[]) {
    add(event, handlers[event])
  }
  return () => {
    for (const remove of removers.splice(0)) remove()
  }
}

/**
 * Ends a client for good: a DISCONNECT packet when `graceful`, a forced close otherwise.
 * Resolves `true` once closed, or `false` when `timeoutMs` elapsed (the socket is destroyed).
 */
export function endClient(
  client: MqttClient,
  graceful: boolean,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (clean: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(clean)
    }
    const timer = setTimeout(() => {
      client.stream?.destroy()
      finish(false)
    }, timeoutMs)
    // Never let mqtt.js schedule a reconnect once we are leaving.
    client.options.reconnectPeriod = 0
    try {
      client.end(!graceful, {}, () => finish(true))
    } catch (err) {
      // mqtt.js throws when the client never got a stream (its connect() failed).
      console.warn('[mqtt] Could not end the client', err)
      client.stream?.destroy()
      finish(false)
    }
  })
}

/**
 * Force-closes a client nobody listens to anymore, without reconnects. Never throws: a client
 * whose `connect()` threw before it had a stream (e.g. `tls.connect` refusing the key) has
 * nothing to close, and mqtt.js's `end()` would throw on the missing stream. A no-op `error`
 * listener stays attached so late errors cannot crash the process.
 */
export function abandonClient(client: MqttClient): void {
  // An 'error' emitted without any listener would throw and crash the main process.
  client.on('error', () => {})
  client.options.reconnectPeriod = 0
  if (client.disconnecting || !client.stream) return
  try {
    client.end(true)
  } catch (err) {
    console.warn('[mqtt] Could not close the client', err)
  }
}
