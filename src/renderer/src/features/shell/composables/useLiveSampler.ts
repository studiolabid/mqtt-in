/**
 * 1 Hz sampler for the status bar: a wall clock (uptime) and a short rolling history of the
 * in / out message rates of every connected session, so switching connections shows an
 * existing trend. Histories are plain arrays exposed through shallow refs (a new array per
 * sample, as `Sparkline` expects).
 */
import { shallowRef, watch, type ShallowRef } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { useMessagesStore, useSessionsStore } from '@/stores'

/** Samples kept per connection (one per second). */
export const RATE_HISTORY_LENGTH = 60

interface RateHistory {
  in: number[]
  out: number[]
}

export interface LiveSampler {
  /** Epoch ms of the last tick. */
  now: ShallowRef<number>
  inRates: ShallowRef<readonly number[]>
  outRates: ShallowRef<readonly number[]>
}

function appendSample(history: readonly number[], value: number): number[] {
  const next = history.length >= RATE_HISTORY_LENGTH ? history.slice(1) : history.slice()
  next.push(Number.isFinite(value) ? Math.max(0, value) : 0)
  return next
}

export function useLiveSampler(connectionId: () => string | null): LiveSampler {
  const messages = useMessagesStore()
  const sessions = useSessionsStore()
  const histories = new Map<string, RateHistory>()

  const now = shallowRef(Date.now())
  const inRates = shallowRef<readonly number[]>([])
  const outRates = shallowRef<readonly number[]>([])

  function publish(): void {
    const id = connectionId()
    const history = id ? histories.get(id) : undefined
    inRates.value = history?.in ?? []
    outRates.value = history?.out ?? []
  }

  function sample(): void {
    now.value = Date.now()
    const current = connectionId()
    const sampled = new Set(sessions.connectedIds)
    if (current) sampled.add(current)
    for (const id of histories.keys()) if (!sampled.has(id)) histories.delete(id)
    for (const id of sampled) {
      const { inRate, outRate } = messages.stats(id)
      const history = histories.get(id) ?? { in: [], out: [] }
      histories.set(id, {
        in: appendSample(history.in, inRate),
        out: appendSample(history.out, outRate)
      })
    }
    publish()
  }

  useIntervalFn(sample, 1000, { immediateCallback: true })
  watch(connectionId, publish)

  return { now, inRates, outRates }
}
