/**
 * The connection of the publish panel, provided to its descendants (e.g. the history rows,
 * which the history popover renders without passing the connection on).
 */
import { inject, provide, type InjectionKey } from 'vue'

const PUBLISH_CONNECTION: InjectionKey<() => string> = Symbol('mqtt-in.publish.connection')

/** Called by `PublishPanel`. */
export function providePublishConnection(connectionId: () => string): void {
  provide(PUBLISH_CONNECTION, connectionId)
}

/** The panel's connection id getter; `null` outside a publish panel. */
export function usePublishConnection(): (() => string) | null {
  return inject(PUBLISH_CONNECTION, null)
}
