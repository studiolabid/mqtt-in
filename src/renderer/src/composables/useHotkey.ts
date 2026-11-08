/**
 * Global keyboard shortcuts (window `keydown`), removed automatically with the calling scope.
 */
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useEventListener } from '@vueuse/core'
import { api } from '@/services/api'
import { isEditableTarget, matchesHotkey, parseHotkey, type Hotkey } from '@/utils/hotkey'

export interface HotkeyOptions {
  /** Disable the shortcut temporarily (e.g. while a dialog is open). Default true. */
  enabled?: MaybeRefOrGetter<boolean>
  /** Also fire while typing in inputs, textareas, contenteditable or CodeMirror. Default false. */
  allowInInputs?: boolean
  /** Call `event.preventDefault()` when the shortcut fires. Default true. */
  preventDefault?: boolean
  /** Fire again while the key is held down. Default false. */
  allowRepeat?: boolean
  /**
   * Skip the shortcut while a dialog, alert dialog or sheet (of any feature) is open, or while
   * keyboard focus is inside a popover. Default false.
   */
  ignoreInDialogs?: boolean
}

const OPEN_MODAL_SELECTOR = [
  '[data-slot="dialog-content"][data-state="open"]',
  '[data-slot="alert-dialog-content"][data-state="open"]',
  '[data-slot="sheet-content"][data-state="open"]'
].join(',')

/** True while a modal surface is open: any shadcn dialog, alert dialog or sheet. */
export function isModalOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector(OPEN_MODAL_SELECTOR) !== null
}

/** True while keyboard focus is inside a dialog, alert dialog or popover. */
export function isFocusInDialog(): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  return (
    active instanceof Element && active.closest('[role="dialog"], [role="alertdialog"]') !== null
  )
}

let platformCache: string | undefined

/** Host platform (`darwin`, `win32`, `linux`), falling back to the user agent. */
export function hostPlatform(): string {
  if (platformCache === undefined) {
    try {
      platformCache = api.app.platform
    } catch {
      const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
      platformCache = /Mac|iPhone|iPad/.test(agent) ? 'darwin' : 'win32'
    }
  }
  return platformCache
}

/**
 * Registers a shortcut such as `mod+k`, `mod+enter`, `mod+shift+f`, `escape`, `mod+,`
 * (`mod` = ⌘ on macOS, Ctrl elsewhere). Several alternatives may be given as an array.
 * Events already handled (`defaultPrevented`), IME composition and — unless `allowInInputs` —
 * events from editable elements are ignored.
 *
 * @returns a function that removes the listener early.
 */
export function useHotkey(
  combo: string | readonly string[],
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {}
): () => void {
  const hotkeys: Hotkey[] = (typeof combo === 'string' ? [combo] : combo).map(parseHotkey)
  const platform = hostPlatform()

  return useEventListener('keydown', (event: KeyboardEvent) => {
    if (!toValue(options.enabled ?? true)) return
    if (event.defaultPrevented || event.isComposing) return
    if (event.repeat && !options.allowRepeat) return
    if (!options.allowInInputs && isEditableTarget(event.target)) return
    if (options.ignoreInDialogs && (isModalOpen() || isFocusInDialog())) return
    if (!hotkeys.some((hotkey) => matchesHotkey(event, hotkey, platform))) return
    if (options.preventDefault !== false) event.preventDefault()
    handler(event)
  })
}
