/**
 * Process-wide monotonic ids for messages and log entries (shared by every session).
 */

let lastMessageId = 0
let lastLogId = 0

/** Next `MqttMessage.id` (unique for the lifetime of the main process). */
export function nextMessageId(): number {
  lastMessageId += 1
  return lastMessageId
}

/** Next `LogEntry.id` (unique for the lifetime of the main process). */
export function nextLogId(): number {
  lastLogId += 1
  return lastLogId
}
