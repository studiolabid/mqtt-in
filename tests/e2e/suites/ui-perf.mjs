/**
 * optIn perf guards (MQTEY_E2E_ONLY=ui-perf or MQTEY_E2E_ALL=1), at 1920×1080:
 * - following a 2,000+ msg/s flood patches the rendered rows instead of remounting them and the
 *   list stays at the bottom (PERF-04, FD-01);
 * - a 20k-topic tree, fully expanded, takes a 2,000 msg/s flood without long tasks (FD-19);
 * - searches over a 100k mixed buffer run in slices: the final count within 3 s and no long task
 *   over 200 ms; on a 6× slower CPU the 'Searching…' spinner shows while a pass runs, and a term
 *   found only in the oldest message never flashes 'none of them match' first (RC-01).
 */
import { sleep, tid } from '../kit.mjs'
import { createConnection, publishAll, showTab, subscribe, waitForRow } from '../lib/ui.mjs'
import {
  countBytes,
  flood,
  publishCorpus,
  recordLongTasks,
  searchCorpus,
  startFrameSampler,
  stopFrameSampler,
  takeLongTasks
} from '../lib/ui-perf.mjs'

const BUFFER = 100_000
const NEEDLE = 'needle-oldest-e2e'

export default {
  name: 'ui-perf',
  order: 90,
  optIn: true,
  broker: true,

  async run(ctx) {
    const { step, capture } = ctx
    const page = () => ctx.page
    let client = null

    await step('launch at 1920×1080, connect and subscribe to #', async () => {
      await ctx.launch({ size: { width: 1920, height: 1080 } })
      await createConnection(ctx, { name: 'Perf' })
      await subscribe(ctx, '#')
      client = await ctx.rawClient()
      await publishAll(client, 'perf/start', ['0'])
      await waitForRow(ctx, 'perf/start', 'in')
    })

    await step(
      'following a 2,000 msg/s flood patches rows, never remounts them (PERF-04)',
      async () => {
        await page().locator(tid('message-list')).focus()
        await page().keyboard.press('End')
        await sleep(300)
        await page().evaluate(() => {
          const list = document.querySelector('[data-testid="message-list"]')
          const counts = (window.__rows = { mounts: 0, batches: 0, idChanges: 0 })
          window.__rowObserver = new MutationObserver((records) => {
            counts.batches += 1
            for (const record of records) {
              if (record.type === 'attributes') counts.idChanges += 1
              for (const node of record.addedNodes) {
                if (node.nodeType === 1 && node.matches('[data-testid="message-row"]'))
                  counts.mounts += 1
              }
            }
          })
          window.__rowObserver.observe(list, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-message-id']
          })
        })
        const load = await flood(client, 4_000, (n) => `flood/${n % 25}`)
        await sleep(600)
        const counts = await page().evaluate(() => {
          window.__rowObserver.disconnect()
          const el = document.querySelector('[data-testid="message-list"]')
          return { ...window.__rows, gap: el.scrollHeight - el.clientHeight - el.scrollTop }
        })
        const rate = Math.round(load.sent / load.seconds)
        const updates = counts.idChanges > 0 ? counts.batches : 0
        ctx.log(
          `${load.sent} msgs (${rate}/s): ${counts.mounts} row mounts over ${updates} updates, ${counts.gap} px from the bottom`
        )
        if (rate < 2_000) throw new Error(`the flood reached only ${rate} msg/s`)
        if (counts.mounts > Math.max(2, updates * 2))
          throw new Error(`${counts.mounts} row mounts over ${updates} updates`)
        if (counts.gap > 4) throw new Error(`the list is ${counts.gap} px above the bottom`)
      },
      { timeout: 60_000 }
    )

    await step(
      'a 20k-topic tree, expanded, takes a 2,000 msg/s flood without long tasks (FD-19)',
      async () => {
        let n = 0
        for (let a = 0; a < 20; a++) {
          for (let b = 0; b < 50; b++) {
            for (let c = 0; c < 20; c++) client.publish(`site/${a}/room/${b}/s${c}`, String(n++))
            if (b % 10 === 0) await sleep(5)
          }
        }
        await sleep(2_500)
        await showTab(ctx, 'topics')
        await recordLongTasks(page())
        await page().getByRole('button', { name: 'Expand all' }).click()
        await sleep(1_500)
        const expand = await takeLongTasks(page())
        const load = await flood(client, 5_000, (k) => {
          const t = (k * 7919) % 20_000
          return `site/${Math.floor(t / 1000)}/room/${Math.floor(t / 20) % 50}/s${t % 20}`
        })
        await sleep(500)
        const during = await takeLongTasks(page())
        const longest = during.length > 0 ? Math.max(...during) : 0
        const rate = Math.round(load.sent / load.seconds)
        const rows = await page().locator(tid('topic-row')).count()
        ctx.log(
          `${rows} rows rendered; expand all: long tasks ${JSON.stringify(expand)}; flood ${rate}/s: ${during.length} long tasks, longest ${longest} ms`
        )
        await ctx.shot('perf-01-tree-20k')
        if (rate < 2_000) throw new Error(`the flood reached only ${rate} msg/s`)
        if (longest > 50)
          throw new Error(`a ${longest} ms long task while the 20k tree took the flood`)
      },
      { timeout: 90_000 }
    )

    const corpus = searchCorpus(BUFFER, NEEDLE)
    await step(
      'a 100k mixed buffer fills (the limit raised to 100K in Settings)',
      async () => {
        await showTab(ctx, 'messages')
        await page().locator(tid('message-list')).focus()
        await page().keyboard.press('Control+L')
        await ctx.click('confirm-accept')
        await ctx.click('open-settings')
        await page().locator('[aria-label="Presets"]').getByText('100K', { exact: true }).click()
        await page().waitForFunction(
          () =>
            document
              .querySelector('[data-testid="settings-max-messages"]')
              ?.value.replace(/\D/g, '') === '100000'
        )
        await ctx.click('settings-back')
        await ctx.waitForTestId('workspace')
        await publishCorpus(client, corpus)
        await page().waitForFunction(
          (want) => document.querySelector(`[aria-label^="${want} messages in memory"]`) !== null,
          BUFFER.toLocaleString('en-US'),
          { timeout: 60_000, polling: 500 }
        )
      },
      { timeout: 120_000 }
    )

    /**
     * Applies a search, then waits for the final 'N of 100,000' count. `cpu` slows the renderer
     * down (CDP CPU throttling, like a slow laptop) so the pass outlasts the spinner's 150 ms delay.
     */
    const measure = async (label, apply, want, { cpu = 1 } = {}) => {
      const cdp = cpu > 1 ? await page().context().newCDPSession(page()) : null
      await cdp?.send('Emulation.setCPUThrottlingRate', { rate: cpu })
      try {
        await recordLongTasks(page())
        await startFrameSampler(page())
        const started = Date.now()
        await apply()
        await page().waitForFunction(
          (title) =>
            document
              .querySelector('[data-testid="messages-match-count"]')
              ?.getAttribute('title')
              ?.startsWith(title),
          `${want.toLocaleString('en-US')} of ${BUFFER.toLocaleString('en-US')}`,
          { timeout: 30_000, polling: 20 }
        )
        const ms = Date.now() - started
        const seen = await stopFrameSampler(page())
        const tasks = await takeLongTasks(page())
        const longest = tasks.length > 0 ? Math.max(...tasks) : 0
        ctx.log(
          `${label}${cpu > 1 ? ` (CPU ÷${cpu})` : ''}: ${want} matches in ${ms} ms (debounce 150 ms and a ` +
            `250 ms count throttle included), longest task ${longest} ms, searching ${seen.searching}, ` +
            `empty states ${seen.kinds.join(',') || 'none'}`
        )
        if (seen.kinds.includes('filtered'))
          throw new Error(`${label}: 'none of them match' flashed during the pass`)
        if (cpu === 1 && (ms > 3_000 || longest > 200))
          throw new Error(`${label}: ${ms} ms, a ${longest} ms long task`)
        return { ms, longest, searching: seen.searching }
      } finally {
        await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 })
        await cdp?.detach()
      }
    }

    await step(
      "on a slow CPU a long search shows 'Searching…', never a false 'no match' (RC-01)",
      async () => {
        // The needle is the oldest message: a newest-first pass finds it last, so before RC-01's
        // empty-kind fix the panel said 'none of them match' while the pass was still running.
        const run = await measure(
          'needle in the oldest message',
          () => ctx.fill('message-search', NEEDLE),
          1,
          { cpu: 6 }
        )
        if (!run.searching) throw new Error(`no 'Searching…' during a ${run.ms} ms search`)
        await ctx.fill('message-search', '')
      },
      { timeout: 60_000 }
    )

    await step(
      'searches over 100k finish within 3 s without a long task over 200 ms (RC-01)',
      async () => {
        // The long-task observer must see a 120 ms busy task, or "no long task" proves nothing.
        await recordLongTasks(page())
        await page().evaluate(
          () =>
            new Promise((done) =>
              setTimeout(() => {
                const end = performance.now() + 120
                while (performance.now() < end) {
                  // a busy task the long-task observer must see
                }
                setTimeout(done, 100)
              })
            )
        )
        const sanity = await takeLongTasks(page())
        if (!sanity.some((ms) => ms >= 100))
          throw new Error(`the long-task observer missed a 120 ms task: ${sanity}`)
        const fill = (text) => () => ctx.fill('message-search', text)
        await measure(
          'cold text search',
          fill('nominal'),
          corpus.filter((m) => m.payload.includes('nominal')).length
        )
        await page().locator('[aria-label="Payload view format"]').click()
        await page().getByRole('option', { name: 'Hex' }).click()
        await measure('hex bytes in the Hex view', fill('de ad'), countBytes(corpus, [0xde, 0xad]))
        await page().locator('[aria-label="Payload view format"]').click()
        await page().getByRole('option', { name: 'Auto' }).click()
        await measure(
          'a new term',
          fill('value=7'),
          corpus.filter((m) => m.payload.includes('value=7')).length
        )
        await capture('perf-02-search-100k')
      },
      { timeout: 120_000 }
    )
  }
}
