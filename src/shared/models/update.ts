/**
 * App updates from the GitHub releases (electron-updater): checked in the background, downloaded
 * automatically, installed on restart. The user data (connections, settings, history) lives in
 * the profile folder, which an update never touches.
 */

/**
 * - `unsupported`: this build cannot update itself (development, automated run, macOS without
 *   code signing, a Linux package other than AppImage); `message` says why.
 * - `idle`: no check yet.
 * - `checking`, `up-to-date`, `downloading` (`percent` 0–100), `ready` (downloaded, installs on
 *   restart or on the next quit), `error` (`message`).
 */
export type UpdatePhase =
  'unsupported' | 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** The running version. */
  currentVersion: string
  /** The newer version (downloading / ready). */
  version?: string
  /** Download progress 0–100 (downloading). */
  percent?: number
  /** Why updates are unavailable (unsupported) or what failed (error). */
  message?: string
  /** Epoch ms of the last finished check. */
  checkedAt?: number
}
