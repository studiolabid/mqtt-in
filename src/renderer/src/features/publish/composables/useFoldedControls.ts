/**
 * The publisher header's folded controls (A11Y-07). In a narrow panel the MQTT 5 properties,
 * history and repeat triggers are hidden and reached through the "More" menu
 * (`PublishMoreMenu`): their popovers then open against the More button, and when one of them
 * (or the repeat dialog) closes, focus returns to that button instead of the hidden trigger.
 */
import { nextTick, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { focusFirst, isFocusable } from '@/utils/focus'

/** What the "More" menu opens once it has closed. */
export type PublishMoreAction = 'properties' | 'history' | 'repeat'

/** A popover or dialog restores focus after its exit animation: check again after it. */
const CLOSE_ANIMATION_MS = 300
const MORE_BUTTON = '[data-testid="publish-more"]'
/** Where focus goes when the trigger it would return to is folded away. */
const FOCUS_FALLBACK = [MORE_BUTTON, '[data-testid="publish-topic"]'] as const

export interface FoldedControls {
  propertiesOpen: Ref<boolean>
  historyOpen: Ref<boolean>
  /** The element the popovers open against: the More button while folded, else null. */
  anchor: ShallowRef<HTMLElement | null>
  /** Runs a "More" menu action. */
  open(action: PublishMoreAction): void
  /** After the repeat dialog closed: back to the More button when focus got lost. */
  restoreFocus(): void
}

function focusLost(): boolean {
  const active = document.activeElement
  return !(active instanceof HTMLElement) || active === document.body || !isFocusable(active)
}

export function useFoldedControls(
  panel: Readonly<Ref<HTMLElement | null>>,
  openRepeat: () => void
): FoldedControls {
  const propertiesOpen = ref(false)
  const historyOpen = ref(false)
  const anchor = shallowRef<HTMLElement | null>(null)

  /**
   * The More button, while it is shown (the panel is narrow). Only its rendering counts: the
   * closing menu may still hide the rest of the page from assistive technology.
   */
  function moreButton(): HTMLElement | null {
    const button = panel.value?.querySelector<HTMLElement>(MORE_BUTTON) ?? null
    return button && button.getClientRects().length > 0 ? button : null
  }

  function restoreFocus(): void {
    const recover = (): void => {
      if (focusLost()) void focusFirst(FOCUS_FALLBACK, panel.value ?? undefined)
    }
    void nextTick(recover)
    setTimeout(recover, CLOSE_ANIMATION_MS)
  }

  // Every opening picks its anchor (the trigger itself while it is shown); every closing
  // recovers a focus that fell back to the page.
  watch(
    [propertiesOpen, historyOpen],
    ([properties, history], [wasProperties, wasHistory]) => {
      if ((properties && !wasProperties) || (history && !wasHistory)) anchor.value = moreButton()
      if ((!properties && wasProperties) || (!history && wasHistory)) restoreFocus()
    },
    { flush: 'sync' }
  )

  function open(action: PublishMoreAction): void {
    if (action === 'properties') propertiesOpen.value = true
    else if (action === 'history') historyOpen.value = true
    else openRepeat()
  }

  return { propertiesOpen, historyOpen, anchor, open, restoreFocus }
}
