/**
 * Load generators and page-side probes for the optIn perf suite (suites/ui-perf.mjs): a
 * 2,000 msg/s flood, a 20k-topic tree, a 100k mixed buffer (rc-b's PERF-01/03 corpus), long-task
 * recording and a frame sampler for transient UI states.
 */
import { sleep } from '../kit.mjs'

/** Publishes `perTick` QoS 0 messages every 20 ms for `ms` (about perTick × 50 msg/s). */
export async function flood(client, ms, topicOf, perTick = 80) {
  const started = Date.now()
  let sent = 0
  while (Date.now() - started < ms) {
    for (let i = 0; i < perTick; i++) {
      client.publish(topicOf(sent), String(sent), { qos: 0 })
      sent += 1
    }
    await sleep(20)
  }
  return { sent, seconds: (Date.now() - started) / 1000 }
}

/** Starts recording long tasks (> 50 ms) in the page; `takeLongTasks` reads and resets them. */
export const recordLongTasks = (page) =>
  page.evaluate(() => {
    window.__longTasks = []
    if (window.__longTaskObserver) return
    window.__longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration))
    })
    window.__longTaskObserver.observe({ type: 'longtask' })
  })

export const takeLongTasks = (page) => page.evaluate(() => window.__longTasks.splice(0))

/**
 * Records, until `stopFrameSampler`, which transient states the message panel shows: the
 * 'Searching…' spinner and the empty-state kinds. Checked after every DOM change (a
 * MutationObserver: a state that lives between two frames is seen too) and every frame.
 */
export const startFrameSampler = (page) =>
  page.evaluate(() => {
    const started = performance.now()
    // counts: when the match count changed ([ms since start, title]); the pass runs from the
    // first count to the last.
    const seen = { searching: false, kinds: [], counts: [] }
    const look = () => {
      if (document.querySelector('[data-testid="messages-searching"]')) seen.searching = true
      const kind = document
        .querySelector('[data-testid="message-empty-state"]')
        ?.getAttribute('data-kind')
      if (kind && !seen.kinds.includes(kind)) seen.kinds.push(kind)
      const title = document
        .querySelector('[data-testid="messages-match-count"]')
        ?.getAttribute('title')
      if (title && title !== seen.counts.at(-1)?.[1]) {
        seen.counts.push([Math.round(performance.now() - started), title.split(' messages')[0]])
      }
    }
    const observer = new MutationObserver(look)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-kind', 'title']
    })
    window.__frameSampler = { seen, running: true, observer }
    const tick = () => {
      if (!window.__frameSampler.running) return
      look()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

export const stopFrameSampler = (page) =>
  page.evaluate(() => {
    window.__frameSampler.running = false
    window.__frameSampler.observer.disconnect()
    return window.__frameSampler.seen
  })

function noise(length, seed) {
  const bytes = Buffer.alloc(length)
  let state = seed >>> 0
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    bytes[i] = state >>> 24
  }
  return bytes
}

function bigJson(seed) {
  const rows = []
  let size = 2
  for (let id = 0; size < 50 * 1024; id++) {
    const row = `{"id":${id},"v":${((id * 7919 + seed) % 100_000) / 100},"name":"item-${(id * 104_729 + seed) % 1_000_000}"}`
    rows.push(row)
    size += row.length + 1
  }
  return Buffer.from(`[${rows.join(',')}]`)
}

/**
 * rc-b's 100k corpus: 50 % small JSON, 30 % text ('nominal'), 15 % 1 KB binary, 4 % small JSON,
 * 1 % 50 KB JSON. The first message carries a unique needle (found last by a newest-first pass).
 */
export function searchCorpus(count, needle) {
  const binaries = Array.from({ length: 32 }, (_, k) => noise(1024, 200 + k))
  const big = Array.from({ length: 8 }, (_, k) => bigJson(100 + k))
  const out = [{ topic: 'perf/first', payload: Buffer.from(needle) }]
  for (let i = 1; i < count; i++) {
    const kind = i % 100
    const topic = `site${i % 8}/area${(i >> 3) % 10}/n${(i >> 5) % 63}`
    let payload
    if (kind < 50 || (kind >= 95 && kind < 99)) {
      payload = Buffer.from(
        `{"t":${((i % 400) / 10).toFixed(1)},"h":${i % 100},"seq":${i},"status":"ok"}`
      )
    } else if (kind < 80)
      payload = Buffer.from(`reading ${i} value=${(i * 7) % 1000} state=nominal`)
    else if (kind < 95) payload = binaries[i % binaries.length]
    else payload = big[i % big.length]
    out.push({ topic, payload })
  }
  return out
}

/** Messages of `corpus` whose first 16 KiB contain the byte sequence `bytes`. */
export function countBytes(corpus, bytes) {
  let n = 0
  for (const { payload } of corpus) {
    const end = Math.min(payload.length, 16 * 1024) - bytes.length
    outer: for (let i = 0; i <= end; i++) {
      for (let j = 0; j < bytes.length; j++) if (payload[i + j] !== bytes[j]) continue outer
      n += 1
      break
    }
  }
  return n
}

/** Publishes a corpus in order (QoS 0), pausing briefly every 2,000 messages. */
export async function publishCorpus(client, corpus) {
  for (let i = 0; i < corpus.length; i++) {
    client.publish(corpus[i].topic, corpus[i].payload, { qos: 0 })
    if (i % 2000 === 1999) await sleep(40)
  }
}
