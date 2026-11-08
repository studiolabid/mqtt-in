/**
 * Focus targets of the workspace (A11Y-11, A11Y-24): where keyboard focus goes after a tab
 * switch (Mod+1/2/3, the palette) and the "Focus …" palette commands. DOM lookups go through
 * `focusFirst`, which waits for Vue's DOM update and skips hidden elements.
 *
 * reka-ui swaps the tab panels a little after the tab changes (its presence handling runs after
 * Vue's update), so the helpers wait a few frames for the shown view before they give up on it.
 */
import type { WorkspaceTab } from '@/types'
import { focusFirst, isFocusable } from '@/utils/focus'

/** The main region of each view (its keyboard-driven list or tree). */
const PANEL_TARGETS: Readonly<Record<WorkspaceTab, readonly string[]>> = {
  messages: ['[data-testid="message-list"]'],
  topics: ['[data-testid="topic-tree"]'],
  logs: ['[data-testid="log-list"]']
}

/** Frames to wait for a view to show (about 130 ms at 60 Hz). */
const SHOW_FRAMES = 8

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/** True when focus is on nothing useful: `<body>`, or an element that is hidden or removed. */
export function isFocusLost(active: Element | null): boolean {
  if (!(active instanceof HTMLElement) || active === document.body) return true
  return !active.isConnected || !isFocusable(active)
}

/**
 * Focuses the main region of a view once it shows (an empty view has none: its tab then).
 *
 * @returns whether something was focused.
 */
export async function focusWorkspaceView(tab: WorkspaceTab): Promise<boolean> {
  for (let frame = 0; frame < SHOW_FRAMES; frame++) {
    if (await focusFirst(PANEL_TARGETS[tab])) return true
    await nextFrame()
  }
  return focusFirst([`[data-testid="workspace-tab-${tab}"]`])
}

/**
 * After switching the workspace tab: when focus was lost (on `<body>`, or inside the panel that
 * was just hidden), moves it to the shown view's main region. Focus elsewhere (the publisher,
 * the sidebar) stays where it is.
 *
 * @returns whether focus was moved.
 */
export async function refocusAfterTabSwitch(tab: WorkspaceTab): Promise<boolean> {
  // Two frames: the previous panel is hidden by then.
  await nextFrame()
  await nextFrame()
  if (!isFocusLost(document.activeElement)) return false
  return focusWorkspaceView(tab)
}

/** Focuses the publisher's topic field (visible even while the publisher is collapsed). */
export function focusPublishTopic(): Promise<boolean> {
  return focusFirst(['[data-testid="publish-topic"]'])
}

/** Focuses the message list (or the Messages tab while the list is empty). */
export function focusMessageList(): Promise<boolean> {
  return focusWorkspaceView('messages')
}
