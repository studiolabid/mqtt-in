/**
 * Keyboard focus around the command palette (A11Y-08).
 *
 * The element focused when the palette opens is captured. Running an entry closes the palette,
 * gives focus back to that element, then runs the action: a dialog opened by the action
 * remembers the original element as its return target, and an action that moves focus itself
 * (a "Focus …" command, a dialog) keeps it. When the palette has finished closing, focus that
 * fell on `<body>` or stayed in the closing palette goes back to the captured element too.
 *
 * reka-ui would otherwise return focus to the dialog's "trigger": the palette's own input,
 * which autofocuses before the dialog records it, so focus ended on `<body>`.
 */
import { nextTick, watch } from 'vue'

/** What focus restoring needs of an element (keeps the helper testable without a DOM). */
export interface FocusTarget {
  readonly isConnected: boolean
  focus(options?: FocusOptions): void
}

/** Refocuses `target` when it is still in the document; returns whether it did. */
export function restoreFocus(target: FocusTarget | null | undefined): boolean {
  if (!target || !target.isConnected) return false
  target.focus({ preventScroll: true })
  return true
}

/** True when focus is nowhere useful: none, `<body>`, or inside `container` (the closing palette). */
export function isFocusLostTo(active: Element | null, container: Node | null): boolean {
  if (!active || active === active.ownerDocument?.body) return true
  return container !== null && container.contains(active)
}

export interface PaletteFocus {
  /** Gives focus back to the element focused before the palette opened (after Vue's update). */
  restore(): Promise<void>
  /** `@close-auto-focus` of the palette's `DialogContent`. */
  onCloseAutoFocus(event: Event): void
}

/** @param isOpen the palette's open state (watched synchronously, before it moves focus). */
export function usePaletteFocus(isOpen: () => boolean): PaletteFocus {
  let captured: HTMLElement | null = null

  watch(
    isOpen,
    (open) => {
      if (!open) return
      const active = document.activeElement
      captured = active instanceof HTMLElement && active !== document.body ? active : null
    },
    { flush: 'sync' }
  )

  async function restore(): Promise<void> {
    await nextTick()
    restoreFocus(captured)
  }

  function onCloseAutoFocus(event: Event): void {
    // reka-ui's default focuses the dialog's trigger, which may be the palette's own input.
    event.preventDefault()
    const container = event.target instanceof Node ? event.target : null
    if (isFocusLostTo(document.activeElement, container)) restoreFocus(captured)
    // Reopened while closing: the new session captured its own element.
    if (!isOpen()) captured = null
  }

  return { restore, onCloseAutoFocus }
}
