/**
 * Toast lifetimes (CT-30). Toasts are still created with `toast` from 'vue-sonner'
 * (ARCHITECTURE §5); the Toaster in `App.vue` uses `DEFAULT_TOAST_DURATION`, and a toast that
 * carries an action passes `duration: ACTION_TOAST_DURATION`, so the action stays reachable
 * long enough for a mouse user to read the toast and for a keyboard user to press Alt+T and Tab
 * to it.
 */

/** Lifetime of a plain toast (result, error, info), in ms. */
export const DEFAULT_TOAST_DURATION = 5_000

/** Lifetime of a toast with an action (Undo, Show in folder, Reconnect, Edit…), in ms. */
export const ACTION_TOAST_DURATION = 10_000

/**
 * Lifetime of a toast that must be read: it stays until it is dismissed (e.g. a startup
 * storage problem that explains why saved data is missing).
 */
export const STICKY_TOAST_DURATION = Number.POSITIVE_INFINITY

/** `ACTION_TOAST_DURATION` when the toast has an action, `DEFAULT_TOAST_DURATION` otherwise. */
export function toastDuration(options: { action?: unknown }): number {
  return options.action ? ACTION_TOAST_DURATION : DEFAULT_TOAST_DURATION
}

/** Height of the status bar at the bottom of the window, in px. */
export const STATUS_BAR_HEIGHT = 28

/**
 * Where the Toaster sits (`position="bottom-left"`): above the status bar, over the sidebar
 * and the subscription panel, away from the action corner on the right (Publish, payload
 * tools, dialog primary buttons, Connect).
 */
export const TOASTER_OFFSET = { bottom: STATUS_BAR_HEIGHT + 8, left: 12 } as const

/** Toast width in px (vue-sonner's default is 356). */
export const TOAST_WIDTH = 340

/** Toasts stacked at once; older ones wait. */
export const VISIBLE_TOASTS = 3
