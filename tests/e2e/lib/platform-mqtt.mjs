/**
 * platform-mqtt helpers: the reconnect waits in the log, status and repeat-job events recorded in
 * the page (through the bridge's listeners), and a counter of raw TCP connections to a broker.
 */

/** '184 ms' → 184, '1.9 s' → 1900, '1 min' → 60000 (src/main/services/mqtt/reconnect-backoff). */
export function parseWait(text) {
  const match = /^([\d.]+) (ms|s|min)$/.exec(text.trim())
  if (!match) return Number.NaN
  const factor = { ms: 1, s: 1_000, min: 60_000 }[match[2]]
  return Math.round(Number(match[1]) * factor)
}

/** The waits of the 'Retrying in …' log rows, oldest first. */
export const retryWaits = (rows) =>
  rows
    .map((row) => /Retrying in ([\d.]+ (?:ms|s|min))/.exec(row.text)?.[1])
    .filter(Boolean)
    .map(parseWait)

/** True when every wait is longer than the one before. */
export const growing = (waits) => waits.every((wait, i) => i === 0 || wait > waits[i - 1])

/** Records every StatusEvent and RepeatJobEvent in the page (window.__e2eStatus / __e2eRepeat). */
export const recordEvents = (page) =>
  page.evaluate(() => {
    if (window.__e2eRecording) return
    window.__e2eRecording = true
    window.__e2eStatus = []
    window.__e2eRepeat = []
    window.mqtey.mqtt.onStatus((event) =>
      window.__e2eStatus.push({ id: event.connectionId, status: event.status })
    )
    window.mqtey.mqtt.onRepeat((event) =>
      window.__e2eRepeat.push({ jobId: event.jobId, state: event.state, sent: event.sent })
    )
  })

/** The recorded statuses of one connection, in order. */
export const statusesOf = (page, id) =>
  page.evaluate(
    (connectionId) =>
      window.__e2eStatus.filter((e) => e.id === connectionId).map((e) => e.status),
    id
  )

/** The recorded repeat-job events (all jobs). */
export const repeatEvents = (page) => page.evaluate(() => window.__e2eRepeat)

/** Counts the TCP connections a broker accepts from now on: `{ count(), stop() }`. */
export function countConnections(broker) {
  let count = 0
  const onConnection = () => {
    count += 1
  }
  broker.server.on('connection', onConnection)
  return {
    count: () => count,
    stop: () => broker.server.off('connection', onConnection)
  }
}

/** The message bytes a raw client receives on `filter`, as hex strings per topic. */
export async function collectHex(client, filter) {
  const received = []
  client.on('message', (topic, payload) => {
    received.push({ topic, hex: Buffer.from(payload).toString('hex') })
  })
  await client.subscribeAsync(filter, { qos: 1 })
  return received
}
