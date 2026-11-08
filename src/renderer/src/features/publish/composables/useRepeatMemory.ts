/**
 * Remembers the last repeat settings per connection for the session (the workspace remounts
 * when switching connections, so this lives outside the components). Forgotten with a deleted
 * connection (`onConnectionRemoved`, CT-11).
 */
import { onConnectionRemoved } from '@/stores/connection-lifecycle'
import type { RepeatSettings } from '@/types'

const DEFAULT_REPEAT: RepeatSettings = { intervalMs: 1_000, count: 0 }
const remembered = new Map<string, RepeatSettings>()
onConnectionRemoved((connectionId) => remembered.delete(connectionId))

export function rememberedRepeat(connectionId: string): RepeatSettings {
  return { ...(remembered.get(connectionId) ?? DEFAULT_REPEAT) }
}

export function rememberRepeat(connectionId: string, settings: RepeatSettings): void {
  remembered.set(connectionId, { ...settings })
}
