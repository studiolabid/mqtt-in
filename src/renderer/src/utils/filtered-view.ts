/**
 * Incrementally maintained, filtered list of messages from a `MessageSource` (pure, no Vue).
 *
 * The source is append-only with head eviction, so a sync only tests new messages and drops
 * evicted ones from the head. A different generation (clear, other buffer) or a new predicate
 * starts a rebuild pass over the whole buffer. A pass tests the newest message first and works
 * back to the oldest. `sync(source, { budgetMs })` stops a pass when its time budget is spent
 * (`pending` stays true) and the next sync continues it, so a search over 200k messages never
 * blocks the renderer in one long task: the rows fill from the newest match (the bottom of a
 * live list) backwards. Without a budget a sync always finishes the pass.
 *
 * `rows` gets a new identity only when its content changed, which makes it cheap to expose
 * through a `shallowRef`.
 */
import type { MqttMessage } from '@shared/models'
import type { MessageSource } from './message-buffer'

export type MessagePredicate = (message: MqttMessage) => boolean

export interface FilteredViewOptions {
  /** Keep only the newest N matches (e.g. the history of one topic). */
  maxRows?: number
  /** Clock of the time budget, in ms (default `performance.now`; injectable for tests). */
  now?: () => number
}

export interface SyncOptions {
  /**
   * Time a rebuild pass may take in this sync, in ms (default: no limit). New messages are
   * always tested; at least one older message is tested per sync, so a pass always progresses.
   */
  budgetMs?: number
}

const EMPTY: readonly MqttMessage[] = Object.freeze([])
const NO_SEQS: readonly number[] = Object.freeze([])
/** Messages tested between two clock reads, at most (bounds the overshoot of the budget). */
const MAX_STRIDE = 64
/** Lower bound of the measured cost per message (avoids dividing by a zero interval). */
const MIN_COST_MS = 0.0001

function defaultNow(): number {
  return performance.now()
}

export class FilteredView {
  private predicate: MessagePredicate | null
  private readonly maxRows: number
  private readonly now: () => number
  private list: readonly MqttMessage[] = EMPTY
  /** Sequence number of every row (parallel to `list`, ascending). */
  private seqs: readonly number[] = NO_SEQS
  /** Generation of the source the rows belong to; -1 = a new pass is due. */
  private generation = -1
  /** Every source message with a sequence in [scanned, processed) has been tested. */
  private processed = 0
  private scanned = 0
  /** The last sync left older messages untested. */
  private partial = false

  /** @param predicate `null` matches every message (fast path). */
  constructor(predicate: MessagePredicate | null = null, options: FilteredViewOptions = {}) {
    this.predicate = predicate
    this.maxRows = Math.max(1, Math.floor(options.maxRows ?? Number.POSITIVE_INFINITY))
    this.now = options.now ?? defaultNow
  }

  /** Matching messages, oldest first. Replaced (never mutated) when it changes. */
  get rows(): readonly MqttMessage[] {
    return this.list
  }

  /** The row limit given to the constructor (Infinity when unlimited). */
  get limit(): number {
    return this.maxRows
  }

  /**
   * True while `rows` is incomplete: a rebuild pass is due (new predicate, reset) or was cut by
   * its time budget. `rows` then holds the newest matches found so far; sync again to go on.
   */
  get pending(): boolean {
    return this.generation === -1 || this.partial
  }

  /** Replaces the predicate; the next `sync` starts a rebuild pass (an unfinished one is dropped). */
  setPredicate(predicate: MessagePredicate | null): void {
    this.predicate = predicate
    this.generation = -1
  }

  /** Forgets every row; the next `sync` rebuilds them. */
  reset(): void {
    this.generation = -1
    this.processed = 0
    this.scanned = 0
    this.partial = false
    this.list = EMPTY
    this.seqs = NO_SEQS
  }

  /**
   * Brings the rows up to date with `source`: drops evicted rows, tests new messages and goes on
   * with the rebuild pass (within `options.budgetMs`).
   *
   * @returns true when `rows` changed (new identity).
   */
  sync(source: MessageSource, options: SyncOptions = {}): boolean {
    const budget = options.budgetMs ?? Number.POSITIVE_INFINITY
    const deadline = Number.isFinite(budget) ? this.now() + Math.max(0, budget) : budget
    let cleared = false
    if (source.generation !== this.generation) {
      // A new pass: nothing tested yet, the rows fill from the newest message backwards.
      cleared = this.list.length > 0
      this.list = EMPTY
      this.seqs = NO_SEQS
      this.generation = source.generation
      this.processed = source.appended
      this.scanned = source.appended
    }
    const { evicted } = source

    // Head eviction: rows are ascending by sequence, so evicted rows form a prefix.
    const drop = lowerBound(this.seqs, evicted)
    if (this.scanned < evicted) this.scanned = evicted

    const added: MqttMessage[] = []
    const addedSeqs: number[] = []
    this.testNewer(source, added, addedSeqs)

    const older: MqttMessage[] = []
    const olderSeqs: number[] = []
    const kept = this.list.length - drop + added.length
    // With a row limit, matches older than the newest `maxRows` would be cut anyway.
    if (kept >= this.maxRows) this.scanned = evicted
    else if (this.scanned > evicted) {
      this.testOlder(source, older, olderSeqs, this.maxRows - kept, deadline)
    }
    this.partial = this.scanned > evicted

    if (drop === 0 && added.length === 0 && older.length === 0) return cleared
    const rest = drop === 0 ? this.list : this.list.slice(drop)
    const restSeqs = drop === 0 ? this.seqs : this.seqs.slice(drop)
    this.apply(older.concat(rest, added), olderSeqs.concat(restSeqs, addedSeqs))
    return true
  }

  /** Tests the messages appended since the last sync (always all of them). */
  private testNewer(source: MessageSource, rows: MqttMessage[], seqs: number[]): void {
    const { messages, evicted } = source
    for (let seq = Math.max(this.processed, evicted); seq < source.appended; seq++) {
      const message = messages[seq - evicted]
      if (this.predicate === null || this.predicate(message)) {
        rows.push(message)
        seqs.push(seq)
      }
    }
    this.processed = source.appended
  }

  /**
   * Goes on with the rebuild pass: tests older messages, newest first, until `limit` matches,
   * the oldest message or the deadline. Fills `rows` / `seqs` oldest first.
   */
  private testOlder(
    source: MessageSource,
    rows: MqttMessage[],
    seqs: number[],
    limit: number,
    deadline: number
  ): void {
    const { messages, evicted } = source
    let index = this.scanned - evicted - 1
    const predicate = this.predicate
    if (predicate === null) {
      const from = Math.max(0, index + 1 - limit)
      for (let i = from; i <= index; i++) {
        rows.push(messages[i])
        seqs.push(evicted + i)
      }
      this.scanned = evicted
      return
    }

    const bounded = Number.isFinite(deadline)
    let last = bounded ? this.now() : 0
    let stride = 1
    let countdown = 1
    while (index >= 0) {
      const message = messages[index]
      index--
      if (predicate(message)) {
        rows.push(message)
        seqs.push(evicted + index + 1)
        if (rows.length >= limit) {
          index = -1
          break
        }
      }
      if (!bounded || --countdown > 0) continue
      // Read the clock every `stride` messages; stop before the next message would likely
      // overrun the deadline. The stride adapts to the measured cost per message.
      const time = this.now()
      const cost = (time - last) / stride
      if (index >= 0 && time + cost > deadline) break
      last = time
      const fit = Math.floor((deadline - time) / 2 / Math.max(cost, MIN_COST_MS))
      stride = Math.max(1, Math.min(MAX_STRIDE, stride * 2, fit))
      countdown = stride
    }
    this.scanned = evicted + index + 1
    rows.reverse()
    seqs.reverse()
  }

  private apply(rows: readonly MqttMessage[], seqs: readonly number[]): void {
    if (rows.length > this.maxRows) {
      const cut = rows.length - this.maxRows
      this.list = rows.slice(cut)
      this.seqs = seqs.slice(cut)
    } else {
      this.list = rows
      this.seqs = seqs
    }
  }
}

/** Index of the first element >= value in an ascending array. */
function lowerBound(values: readonly number[], value: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (values[mid] < value) low = mid + 1
    else high = mid
  }
  return low
}
