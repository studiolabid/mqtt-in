/**
 * What launching mqtt-in again does to the instance that is already running (the new process quits
 * right away: one instance per profile). Pure, so every case is unit-tested.
 */
export type SecondInstanceAction = 'ignore' | 'focus' | 'reopen' | 'relaunch-after-quit'

export interface SecondInstanceState {
  /** Automated run (`MQTTIN_E2E=1`): its window stays off-screen and never takes the focus. */
  background: boolean
  /**
   * The app is quitting (its sessions are disconnecting): a window opened now would be closed
   * again by the deferred quit, leaving nothing running.
   */
  quitting: boolean
  /** A main window exists (it may be minimized or hidden). */
  hasWindow: boolean
}

/**
 * - `ignore`: automated runs never come forward;
 * - `relaunch-after-quit`: finish quitting, then start again (`app.relaunch()`);
 * - `focus`: restore and focus the open window;
 * - `reopen`: open a new main window (macOS keeps running without windows).
 */
export function secondInstanceAction({
  background,
  quitting,
  hasWindow
}: SecondInstanceState): SecondInstanceAction {
  if (background) return 'ignore'
  if (quitting) return 'relaunch-after-quit'
  return hasWindow ? 'focus' : 'reopen'
}
