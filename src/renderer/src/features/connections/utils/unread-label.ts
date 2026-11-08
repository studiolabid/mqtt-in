/**
 * Texts of the unread pill of a sidebar connection (FP-2, PRODUCT-06): how many messages arrived
 * since its workspace was last shown (`useUiStore().unreadCount`, CT-12).
 */
import { formatNumber } from '@/utils/format'

/** Counts above this read `99+`. */
export const UNREAD_CAP = 99

/** The pill text: `''` (no pill) for 0, `'1'` … `'99'`, then `'99+'`. */
export function unreadLabel(count: number): string {
  if (!Number.isFinite(count) || count < 1) return ''
  return count > UNREAD_CAP ? `${UNREAD_CAP}+` : String(Math.floor(count))
}

function messages(count: number): string {
  return `${formatNumber(count)} new message${count === 1 ? '' : 's'}`
}

/** Tooltip: `5 new messages since you last viewed this connection`. */
export function unreadTitle(count: number): string {
  return `${messages(count)} since you last viewed this connection`
}

/** Part of the row's accessible name: `5 new messages`. */
export function unreadSpoken(count: number): string {
  return messages(count)
}
