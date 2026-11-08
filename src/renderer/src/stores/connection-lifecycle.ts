/**
 * The one mechanism for pruning per-connection state (CT-11): a plain registry, no Pinia.
 *
 * Every map, set or reactive record keyed by connection id registers a cleanup here. When a
 * profile is deleted (`useConnectionsStore().remove()`, once the main process confirmed),
 * `notifyConnectionRemoved(id)` runs every cleanup. Nothing has to import the stores that hold
 * the state, so the connections store depends on no other store.
 *
 * - Stores register in their setup and unregister with the store's scope:
 *   `onScopeDispose(onConnectionRemoved(forget))` (test Pinias do not pile up registrations).
 * - Feature modules with module-level state register once at module level:
 *   `onConnectionRemoved((id) => states.delete(id))`.
 */

export type ConnectionCleanup = (connectionId: string) => void

/** One entry per registration: registering the same function twice runs it twice. */
const registrations: Array<{ cleanup: ConnectionCleanup }> = []

/**
 * Registers `cleanup`, called with the id of every deleted connection.
 *
 * @returns a function that removes this registration (calling it again does nothing).
 */
export function onConnectionRemoved(cleanup: ConnectionCleanup): () => void {
  const entry = { cleanup }
  registrations.push(entry)
  return () => {
    const index = registrations.indexOf(entry)
    if (index !== -1) registrations.splice(index, 1)
  }
}

/**
 * Runs every registered cleanup for a deleted connection, in registration order. A cleanup
 * that throws is logged and the others still run.
 */
export function notifyConnectionRemoved(connectionId: string): void {
  // A copy: a cleanup may unregister itself (or others) while running.
  for (const { cleanup } of registrations.slice()) {
    try {
      cleanup(connectionId)
    } catch (err) {
      console.error(`[mqtey] cleanup of the deleted connection ${connectionId} failed:`, err)
    }
  }
}
