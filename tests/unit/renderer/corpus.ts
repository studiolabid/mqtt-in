/**
 * Large message corpora for the search and performance tests, and a garbage collector for heap
 * measurements.
 */
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import type { MqttMessage } from '@shared/models'
import { message, utf8 } from './helpers'

/** Deterministic pseudo-random bytes (a fixed LCG: the same corpus on every run). */
function noise(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let state = seed >>> 0
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    bytes[i] = state >>> 24
  }
  return bytes
}

function bigJson(seed: number): Uint8Array {
  const rows: string[] = []
  let size = 2
  for (let id = 0; size < 50 * 1024; id++) {
    const row = `{"id":${id},"v":${((id * 7919 + seed) % 100_000) / 100},"ok":${id % 2 === 0},"name":"item-${(id * 104_729 + seed) % 1_000_000}"}`
    rows.push(row)
    size += row.length + 1
  }
  return utf8(`[${rows.join(',')}]`)
}

/**
 * The audit's mix (PERF-01): 50 % small JSON, 30 % text, 15 % 1 KB binary, 5 % 50 KB JSON, on
 * 5,000 topics. Binary and large payloads are shared between messages, like repeated frames.
 */
export function mixedCorpus(count: number, connectionId = 'perf'): MqttMessage[] {
  const binaries = Array.from({ length: 32 }, (_, k) => noise(1024, 200 + k))
  const large = Array.from({ length: 8 }, (_, k) => bigJson(100 + k))
  return Array.from({ length: count }, (_, i) => {
    const kind = (i * 7) % 20
    const payload =
      kind < 10
        ? utf8(`{"t":${((i % 400) / 10).toFixed(1)},"h":${i % 100},"seq":${i},"status":"ok"}`)
        : kind < 16
          ? utf8(`reading ${i} value=${(i * 7) % 1000} state=nominal`)
          : kind < 19
            ? binaries[i % binaries.length]
            : large[i % large.length]
    return message({
      connectionId,
      topic: `site${i % 8}/area${(i >> 3) % 10}/n${(i >> 5) % 63}`,
      payload,
      timestamp: 1_700_000_000_000 + i
    })
  })
}

/**
 * A full garbage collection, or null when V8 does not let us expose one. Uses `globalThis.gc`
 * (`--expose-gc`) when present, otherwise enables the flag at runtime (as jest's leak detector
 * does).
 */
export function collectGarbage(): (() => void) | null {
  const exposed: unknown = Reflect.get(globalThis, 'gc')
  if (typeof exposed === 'function') return () => Reflect.apply(exposed, globalThis, [])
  try {
    setFlagsFromString('--expose-gc')
    const gc: unknown = runInNewContext('gc')
    return typeof gc === 'function' ? () => Reflect.apply(gc, globalThis, []) : null
  } catch {
    return null
  }
}
