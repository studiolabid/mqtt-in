/**
 * Screen reader announcements of connection changes (A11Y-17): a polite live region in the
 * status bar says when a session drops, comes back or ends — "<name>: connection lost,
 * reconnecting…", "<name>: connected", "<name>: disconnected". Failures already raise a toast
 * (announced by the toaster), so they are not repeated here.
 *
 * Announcements are debounced per connection: a flapping session announces its settled state
 * once instead of every step.
 */
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { ConnectionStatus } from '@shared/models'
import { useConnectionsStore, useSessionsStore } from '@/stores'

/** How long a status must hold before it is announced. */
export const ANNOUNCE_DELAY_MS = 800

/** Appended to a repeated announcement, so the live region changes and is read again. */
export const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b)

/**
 * What a status transition announces, or null. Only observed transitions count: sessions that
 * appear already connected (restored after a renderer reload) are not announced.
 */
export function statusAnnouncement(
  name: string,
  previous: ConnectionStatus | undefined,
  next: ConnectionStatus
): string | null {
  if (previous === next) return null
  if (next === 'reconnecting' && previous === 'connected') {
    return `${name}: connection lost, reconnecting…`
  }
  if (next === 'connected' && (previous === 'connecting' || previous === 'reconnecting')) {
    return `${name}: connected`
  }
  if (
    next === 'disconnected' &&
    (previous === 'connected' || previous === 'disconnecting' || previous === 'reconnecting')
  ) {
    return `${name}: disconnected`
  }
  return null
}

export interface StatusAnnouncer {
  /** Text of the live region (the latest announcement). */
  message: Readonly<Ref<string>>
}

export function useStatusAnnouncer(): StatusAnnouncer {
  const sessions = useSessionsStore()
  const connections = useConnectionsStore()
  const message = ref('')
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** The status each connection had at its last announcement check. */
  const known = new Map<string, ConnectionStatus>()

  const statuses = computed(() => {
    const map = new Map<string, ConnectionStatus>()
    for (const view of Object.values(sessions.sessions)) map.set(view.connectionId, view.status)
    return map
  })

  function announce(text: string): void {
    // A repeated text must change the region's content to be read again.
    message.value = message.value === text ? `${text}${ZERO_WIDTH_SPACE}` : text
  }

  function schedule(connectionId: string, text: string): void {
    clearTimeout(timers.get(connectionId))
    timers.set(
      connectionId,
      setTimeout(() => {
        timers.delete(connectionId)
        announce(text)
      }, ANNOUNCE_DELAY_MS)
    )
  }

  // Immediate: the sessions known at start are recorded (and not announced).
  watch(
    statuses,
    (next) => {
      for (const [id, status] of next) {
        const previous = known.get(id)
        known.set(id, status)
        const name = connections.get(id)?.name ?? 'Connection'
        const text = statusAnnouncement(name, previous, status)
        if (text) schedule(id, text)
        // A transition that announces nothing (e.g. back to connecting) cancels a pending one.
        else if (previous !== status) clearTimeout(timers.get(id))
      }
      for (const id of [...known.keys()]) if (!next.has(id)) known.delete(id)
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  })

  return { message }
}
