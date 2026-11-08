/**
 * Keyboard helpers of the publish panel (the publish shortcut comes from the registry).
 */
import { hostPlatform } from '@/composables'
import { matchesHotkey, parseHotkey } from '@/utils/hotkey'
import { SHORTCUTS } from '@/utils/shortcuts'

const PUBLISH_HOTKEY = parseHotkey(SHORTCUTS.publish.combo)

/** True for the publish shortcut (Mod+Enter) on this platform. */
export function isPublishShortcut(event: KeyboardEvent): boolean {
  return !event.isComposing && matchesHotkey(event, PUBLISH_HOTKEY, hostPlatform())
}

/** `aria-keyshortcuts` value of the publish shortcut. */
export function publishAriaShortcut(): string {
  return hostPlatform() === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
}
