/**
 * View models shared by the message feature's components.
 */

/** Quick actions offered on a hovered message row. */
export type RowAction = 'copy-payload' | 'copy-topic' | 'edit'

/** Which placeholder the message panel shows instead of the list. */
export type MessageEmptyKind =
  'disconnected' | 'connecting' | 'no-subscriptions' | 'waiting' | 'filtered' | 'paused'

/** Height of a message row (two lines), in px. The list is virtualized with fixed sizes. */
export const MESSAGE_ROW_HEIGHT = 52
