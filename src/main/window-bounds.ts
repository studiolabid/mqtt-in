/**
 * Pure window-geometry helpers (restoring saved bounds safely across monitor changes).
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface InitialBounds {
  /** `x` / `y` are omitted to let the OS center the window. */
  bounds: { x?: number; y?: number; width: number; height: number }
  maximized: boolean
}

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 800 } as const
export const MIN_WINDOW_SIZE = { width: 960, height: 600 } as const

/** Height of the title bar strip at the top of the window (`TITLE_BAR_HEIGHT` in theme.ts). */
const TITLE_BAR_HEIGHT = 40

/**
 * How much of the title bar strip must be on one display for a saved position to be kept: wide
 * enough to grab and drag the window, and at least half its height (the window controls too).
 */
const MIN_TITLE_BAR_VISIBLE = { width: 120, height: TITLE_BAR_HEIGHT / 2 } as const

/** True when `a` and `b` overlap by at least `min` pixels in both directions. */
export function intersects(a: Rect, b: Rect, min = { width: 1, height: 1 }): boolean {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return overlapX >= min.width && overlapY >= min.height
}

/** Overlapping area of `a` and `b` (0 when they do not overlap). */
function overlapArea(a: Rect, b: Rect): number {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0
}

/** The work area showing most of the title bar strip `strip`, if it shows enough of it. */
function displayOfTitleBar(strip: Rect, displays: readonly Rect[]): Rect | undefined {
  const minVisible = {
    width: Math.min(MIN_TITLE_BAR_VISIBLE.width, strip.width),
    height: MIN_TITLE_BAR_VISIBLE.height
  }
  let best: Rect | undefined
  for (const display of displays) {
    if (!intersects(strip, display, minVisible)) continue
    if (!best || overlapArea(strip, display) > overlapArea(strip, best)) best = display
  }
  return best
}

interface Size {
  width: number
  height: number
}

/** `size` limited to `area` (a work area), but never below the minimum window size. */
function fitSize(size: Size, area: Rect | undefined): Size {
  if (!area) return size
  return {
    width: Math.max(MIN_WINDOW_SIZE.width, Math.min(size.width, area.width)),
    height: Math.max(MIN_WINDOW_SIZE.height, Math.min(size.height, area.height))
  }
}

/**
 * Initial window geometry from the saved state and the work areas of the `displays`:
 * - the saved position is kept only when the window's title bar is reachable: at least 120 px
 *   of its 40 px strip, and half its height, on one display (after unplugging a monitor stacked
 *   above, a window at y = -1000 would open with its title bar and controls off screen);
 *   otherwise `x` / `y` are left out and the OS centers the window on the `primary` display;
 * - the saved size, at least the minimum, at most the work area of that display (when narrowing
 *   a window would move its title bar off that display, the position is dropped as well).
 */
export function resolveInitialBounds(
  saved: SavedBounds | undefined,
  displays: readonly Rect[],
  primary: Rect | undefined = displays[0]
): InitialBounds {
  if (!saved) return { bounds: { ...DEFAULT_WINDOW_SIZE }, maximized: false }
  const size: Size = {
    width: Math.max(MIN_WINDOW_SIZE.width, Math.round(saved.width)),
    height: Math.max(MIN_WINDOW_SIZE.height, Math.round(saved.height))
  }
  if (saved.x !== undefined && saved.y !== undefined) {
    const x = Math.round(saved.x)
    const y = Math.round(saved.y)
    const strip = (width: number): Rect => ({ x, y, width, height: TITLE_BAR_HEIGHT })
    const display = displayOfTitleBar(strip(size.width), displays)
    const fitted = display ? fitSize(size, display) : size
    // Narrowed to that display, the title bar must still be on it.
    if (display && displayOfTitleBar(strip(fitted.width), [display])) {
      return { bounds: { x, y, ...fitted }, maximized: saved.maximized }
    }
  }
  return { bounds: fitSize(size, primary), maximized: saved.maximized }
}

/** Gap between a background window and the leftmost display. */
const OFFSCREEN_GAP = 200

/**
 * Geometry for a background (automation) window: the default size, placed left of every display
 * (`displays` are their bounds), so the window renders normally but is never on screen.
 */
export function offscreenBounds(displays: readonly Rect[]): Rect {
  const left = displays.length > 0 ? Math.min(...displays.map((display) => display.x)) : 0
  const top = displays.length > 0 ? Math.min(...displays.map((display) => display.y)) : 0
  return {
    x: left - DEFAULT_WINDOW_SIZE.width - OFFSCREEN_GAP,
    y: top,
    width: DEFAULT_WINDOW_SIZE.width,
    height: DEFAULT_WINDOW_SIZE.height
  }
}
