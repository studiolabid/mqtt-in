/**
 * ARIA of the log list (A11Y-09): the list is a listbox whose keyboard cursor is announced
 * through `aria-activedescendant`; each entry is an option with a stable id, selected while it
 * is under the cursor, expandable when it has a detail, and positioned in the whole (virtualized)
 * list.
 */
import type { LogEntry } from '@shared/models'

/** DOM id of a log row (the target of the list's `aria-activedescendant`). */
export function logRowId(entryId: number): string {
  return `log-row-${entryId}`
}

export interface LogRowState {
  /** Under the keyboard cursor. */
  active: boolean
  /** Its detail is shown. */
  expanded: boolean
  /** Position in the filtered list (0-based). */
  index: number
  /** Entries in the filtered list. */
  total: number
}

export interface LogRowAria {
  id: string
  role: 'option'
  'aria-selected': boolean
  /** Only on entries that have a detail to expand. */
  'aria-expanded'?: boolean
  'aria-posinset': number
  'aria-setsize': number
}

export function logRowAria(entry: Pick<LogEntry, 'id' | 'detail'>, state: LogRowState): LogRowAria {
  const aria: LogRowAria = {
    id: logRowId(entry.id),
    role: 'option',
    'aria-selected': state.active,
    'aria-posinset': state.index + 1,
    'aria-setsize': state.total
  }
  if (entry.detail) aria['aria-expanded'] = state.expanded
  return aria
}
