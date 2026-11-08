/**
 * Runs a task in a later macrotask, after the renderer had a chance to paint and handle input:
 * the "yield" of time-sliced work such as `FilteredView` rebuild passes (pure, no Vue).
 *
 * Uses a `MessageChannel` (its tasks are not clamped to 4 ms like nested `setTimeout(0)`), or
 * `setTimeout` where there is none. The channel is opened on the first `schedule` and closed by
 * `cancel`, so an idle task holds no open port.
 */
export interface Macrotask {
  /** Runs the task once in a later macrotask (no-op while a run is already scheduled). */
  schedule(): void
  /** Drops a scheduled run and releases the channel. */
  cancel(): void
  /** Whether a run is scheduled. */
  readonly scheduled: boolean
}

export function createMacrotask(task: () => void): Macrotask {
  let scheduled = false
  let channel: MessageChannel | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const run = (): void => {
    timer = null
    if (!scheduled) return
    scheduled = false
    task()
  }

  return {
    schedule(): void {
      if (scheduled) return
      scheduled = true
      if (typeof MessageChannel === 'function') {
        if (!channel) {
          channel = new MessageChannel()
          channel.port1.onmessage = run
        }
        channel.port2.postMessage(null)
      } else {
        timer = setTimeout(run, 0)
      }
    },
    cancel(): void {
      scheduled = false
      if (timer !== null) clearTimeout(timer)
      timer = null
      channel?.port1.close()
      channel?.port2.close()
      channel = null
    },
    get scheduled(): boolean {
      return scheduled
    }
  }
}
