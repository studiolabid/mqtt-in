/**
 * Remembered workspace layout (shared by every connection): subscription panel width and
 * publish panel height in pixels, and whether the user collapsed the publisher to its header.
 * Kept in localStorage in pixels, so a restored layout never depends on the window size.
 *
 * The publisher is fitted to the room it has (`publisherHeightFor`): on short windows and at high
 * zoom it is capped, or collapsed when even its minimum would leave the messages less than two
 * rows. Fitting never changes the remembered height or the user's collapsed choice.
 */
import { finiteOr, isRecord, readPreference, writePreference } from '@/utils/preferences'

export const SUBSCRIPTIONS_WIDTH = { min: 200, max: 440, default: 240 } as const
/** `collapsed` = the publish panel's header (h-10). */
export const PUBLISH_HEIGHT = { collapsed: 40, min: 150, default: 264 } as const

/**
 * Room the messages keep when the publisher is fitted: tab bar and toolbar (40 px each) plus
 * two message rows (52 px each), rounded up.
 */
export const MESSAGES_MIN_HEIGHT = 200

/** Title bar, workspace header and status bar: what the panels cannot use. */
export const WINDOW_CHROME_HEIGHT = 116
/** A publisher never opens taller than this share of the panels' height. */
const PUBLISH_MAX_SHARE = 0.45
/** The resize handle between the messages and the publisher. */
const HANDLE_HEIGHT = 1

/**
 * True when a publisher of `size` px shows only its header. reka-ui reports pixel sizes with
 * floating-point noise (and never calls `onCollapse` / `onExpand` for px panels), so one pixel of
 * tolerance is allowed.
 */
export function isPublisherCollapsed(size: number): boolean {
  return size <= PUBLISH_HEIGHT.collapsed + 1
}

/**
 * Publisher height for a panel group of `groupHeight` px (messages + handle + publisher): the
 * `remembered` height, capped at 45 % of the group and so that the messages keep
 * `MESSAGES_MIN_HEIGHT`, never below `PUBLISH_HEIGHT.min`. `'collapsed'` when the group cannot
 * hold both minimums (short windows, high zoom).
 */
export function publisherHeightFor(groupHeight: number, remembered: number): number | 'collapsed' {
  const room = groupHeight - MESSAGES_MIN_HEIGHT - HANDLE_HEIGHT
  if (!Number.isFinite(room) || room < PUBLISH_HEIGHT.min) return 'collapsed'
  const cap = Math.min(Math.round(groupHeight * PUBLISH_MAX_SHARE), room)
  const wanted = Number.isFinite(remembered) ? remembered : PUBLISH_HEIGHT.default
  return Math.round(Math.max(PUBLISH_HEIGHT.min, Math.min(wanted, cap)))
}

/**
 * Initial publisher height for a window of `windowHeight` px, before the panel group is measured
 * (see `publisherHeightFor`).
 */
export function initialPublishHeight(
  remembered: number,
  windowHeight: number
): number | 'collapsed' {
  return publisherHeightFor(windowHeight - WINDOW_CHROME_HEIGHT, remembered)
}

const STORAGE_KEY = 'mqtt-in.workspace.layout'
const WRITE_DELAY_MS = 300

export interface WorkspaceLayout {
  subscriptionsWidth: number
  publishHeight: number
  publishCollapsed: boolean
}

const DEFAULT_LAYOUT: WorkspaceLayout = {
  subscriptionsWidth: SUBSCRIPTIONS_WIDTH.default,
  publishHeight: PUBLISH_HEIGHT.default,
  publishCollapsed: false
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(Math.min(max, Math.max(min, finiteOr(value, fallback))))
}

function load(): WorkspaceLayout {
  const record = readPreference(STORAGE_KEY)
  if (!isRecord(record)) return { ...DEFAULT_LAYOUT }
  return {
    subscriptionsWidth: clamp(
      record.subscriptionsWidth,
      SUBSCRIPTIONS_WIDTH.min,
      SUBSCRIPTIONS_WIDTH.max,
      SUBSCRIPTIONS_WIDTH.default
    ),
    publishHeight: clamp(
      record.publishHeight,
      PUBLISH_HEIGHT.min,
      Number.MAX_SAFE_INTEGER,
      PUBLISH_HEIGHT.default
    ),
    publishCollapsed: record.publishCollapsed === true
  }
}

let current: WorkspaceLayout | undefined
let writeTimer: ReturnType<typeof setTimeout> | undefined

function write(): void {
  writeTimer = undefined
  writePreference(STORAGE_KEY, current)
}

/** The remembered layout (read once, then kept in memory). */
export function workspaceLayout(): WorkspaceLayout {
  current ??= load()
  return { ...current }
}

/** Updates the remembered layout (written to storage shortly after the last change). */
export function rememberWorkspaceLayout(patch: Partial<WorkspaceLayout>): void {
  current = { ...workspaceLayout(), ...patch }
  if (writeTimer !== undefined) clearTimeout(writeTimer)
  writeTimer = setTimeout(write, WRITE_DELAY_MS)
}
