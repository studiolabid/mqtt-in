/**
 * Clearing retained messages (FP-1; pure, no Vue): the texts of the confirms and toasts, the
 * QoS of a clear and a small concurrency runner.
 *
 * A clear is an empty retained PUBLISH. It goes out at QoS 1 (capped by the broker's Maximum
 * QoS), so a refusal (an MQTT 5 PUBACK ≥ 0x80, e.g. not authorized) surfaces instead of a
 * "cleared" that never happened (MQTT-22).
 */
import type { QoS } from '@shared/models'

/** Clears in flight at once (bulk). */
export const CLEAR_CONCURRENCY = 8
/** Topics named in the bulk confirm. */
export const CONFIRM_LISTED = 5

/** QoS 1, or the broker's Maximum QoS when it is lower. */
export function clearQos(maximumQoS: QoS | undefined): QoS {
  return maximumQoS === 0 ? 0 : 1
}

export interface ConfirmText {
  title: string
  description: string
}

/**
 * The single clear. `known`: the topic is known to hold a retained message; otherwise the
 * broker may or may not keep one (live deliveries usually arrive without the retain flag).
 */
export function singleConfirm(topic: string, known: boolean): ConfirmText {
  return known
    ? {
        title: 'Clear retained message?',
        description: `An empty retained message is published to “${topic}”, so the broker deletes the message it keeps for new subscribers. Current subscribers receive an empty message.`
      }
    : {
        title: 'Clear retained message?',
        description: `An empty retained message is published to “${topic}”. If the broker keeps a retained message for this topic it is deleted; current subscribers receive an empty message.`
      }
}

/** The bulk clear: the count, the first `CONFIRM_LISTED` topics and what subscribers see. */
export function bulkConfirm(topics: readonly string[]): ConfirmText {
  const count = topics.length
  const named = topics.slice(0, CONFIRM_LISTED).map((topic) => `“${topic}”`)
  const more = count > CONFIRM_LISTED ? ` and ${count - CONFIRM_LISTED} more` : ''
  return {
    title: `Clear ${count} retained ${count === 1 ? 'message' : 'messages'}?`,
    description: `${named.join(', ')}${more}. Current subscribers receive an empty message on each topic.`
  }
}

export function progressText(done: number, total: number): string {
  return `Clearing ${done}/${total}…`
}

export interface ClearSummary {
  ok: boolean
  title: string
}

/** '37 retained messages cleared' or 'Cleared 35 of 37 — 2 failed: <first error>'. */
export function clearSummary(total: number, failures: readonly string[]): ClearSummary {
  if (failures.length === 0) {
    return { ok: true, title: `${total} retained ${total === 1 ? 'message' : 'messages'} cleared` }
  }
  const cleared = total - failures.length
  return {
    ok: false,
    title: `Cleared ${cleared} of ${total} — ${failures.length} failed: ${failures[0]}`
  }
}

/**
 * Runs `task` for every item with at most `limit` in flight, in order. `onSettled` gets the
 * number of finished tasks after each one. A task must not throw (report through its result).
 */
export async function runLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
  onSettled?: (done: number) => void
): Promise<void> {
  let next = 0
  let done = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]
      await task(item)
      onSettled?.(++done)
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker)
  await Promise.all(workers)
}
