/**
 * Focus recovery (A11Y-11): when the focused element is hidden or removed (a tab switch, an
 * emptied list, a closed view), keyboard focus would fall back to `<body>` and screen readers
 * lose their place. `focusFirst` moves it to the next sensible target instead.
 *
 * The only util that depends on Vue: it waits for Vue's DOM flush (`nextTick`) before looking.
 */
import { nextTick } from 'vue'

/** The parts of an element `focusFirst` uses (keeps it testable without a DOM). */
export interface FocusCandidate {
  focus(options?: FocusOptions): void
  getClientRects(): { length: number }
  checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean
  closest?: (selector: string) => unknown
  disabled?: boolean
}

/** The parts of a `ParentNode` `focusFirst` uses. */
export interface FocusRoot {
  querySelectorAll(selectors: string): ArrayLike<unknown>
}

function isCandidate(value: unknown): value is FocusCandidate {
  if (typeof value !== 'object' || value === null) return false
  const el = value as Partial<FocusCandidate>
  return typeof el.focus === 'function' && typeof el.getClientRects === 'function'
}

/** Rendered (not `display: none`, not `visibility: hidden`), enabled and not inert. */
export function isFocusable(el: FocusCandidate): boolean {
  if (el.disabled === true) return false
  if (typeof el.closest === 'function' && el.closest('[inert], [aria-hidden="true"]')) return false
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ visibilityProperty: true })
  }
  return el.getClientRects().length > 0
}

/**
 * Waits for the DOM to update (Vue's next tick), then focuses the first visible, enabled
 * element matching the selectors, tried in order (e.g. `['[data-slot=message-list]',
 * '[data-slot=tabs-trigger][data-state=active]']`).
 *
 * @param root where to look (default: the document).
 * @returns false when nothing matched (focus is left where it is).
 */
export async function focusFirst(
  selectors: readonly string[],
  root?: ParentNode | FocusRoot
): Promise<boolean> {
  await nextTick()
  const scope: FocusRoot | undefined =
    root ?? (typeof document === 'undefined' ? undefined : document)
  if (!scope) return false
  for (const selector of selectors) {
    let matches: ArrayLike<unknown>
    try {
      matches = scope.querySelectorAll(selector)
    } catch {
      continue // an invalid selector must not break the others
    }
    for (let i = 0; i < matches.length; i++) {
      const el = matches[i]
      if (!isCandidate(el) || !isFocusable(el)) continue
      el.focus()
      return true
    }
  }
  return false
}
