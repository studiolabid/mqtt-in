/**
 * Saved messages and retained safety in the publisher: the draft is saved under a name, typing
 * that name in the payload + Tab loads it (topic too), ▶ in the list publishes it as it is, the
 * palette loads it; a retained publish offers Undo, which clears it on the broker.
 */
import { sleep, tid } from '../kit.mjs'
import {
  createConnection,
  dismissToasts,
  runPalette,
  subscribe,
  waitForRow,
  waitForToast
} from '../lib/ui.mjs'

const TOPIC = 'e2e/cmd/A1'
const PAYLOAD = '{"id":4,"cmd":"timer","min":1}'

/** Text of the payload editor. */
const payloadText = (page) => page.locator(tid('publish-payload', ' .cm-content')).innerText()

async function setPayload(ctx, text) {
  await ctx.page.locator(tid('publish-payload', ' .cm-content')).click()
  await ctx.page.keyboard.press('ControlOrMeta+A')
  await ctx.page.keyboard.press('Delete')
  if (text) await ctx.page.keyboard.insertText(text)
}

async function setTopic(ctx, topic) {
  await ctx.fill('publish-topic', topic)
  await ctx.page.keyboard.press('Escape') // closes the topic suggestions
}

/** The retained message a fresh subscriber of `topic` receives, or null after `ms`. */
async function retainedOn(ctx, topic, ms = 800) {
  const client = await ctx.rawClient()
  try {
    const received = new Promise((resolve) => {
      client.on('message', (_topic, payload) => resolve(payload.toString('utf8')))
      setTimeout(() => resolve(null), ms)
    })
    await client.subscribeAsync(topic)
    return await received
  } finally {
    await client.close()
  }
}

export default {
  name: 'ui-saved-messages',
  order: 41,
  broker: true,

  async run(ctx) {
    const { step, capture } = ctx

    await step('launch and connect', async () => {
      await ctx.launch({ size: { width: 1280, height: 800 } })
      await createConnection(ctx, { name: 'Saved' })
      await subscribe(ctx, '#')
    })

    await step('the draft is saved under a name', async () => {
      await setTopic(ctx, TOPIC)
      await setPayload(ctx, PAYLOAD)
      await ctx.click('publish-saved')
      await ctx.waitForTestId('publish-saved-panel')
      await ctx.click('publish-saved-new')
      await ctx.fill('publish-saved-name', 'timer1')
      await ctx.shot('saved-01-form')
      await ctx.click('publish-saved-save')
      await ctx.waitForTestId('publish-saved-row', { extra: '[data-name="timer1"]' })
      await ctx.shot('saved-02-list')
      await ctx.page.keyboard.press('Escape')
      await ctx.waitForTestId('publish-saved-panel', { state: 'hidden' })
    })

    await step('typing its name in the payload and Tab loads it, topic too', async () => {
      await setTopic(ctx, 'e2e/other')
      await setPayload(ctx, '')
      await ctx.page.keyboard.type('tim', { delay: 20 })
      const popup = ctx.page.locator('.cm-tooltip-autocomplete')
      await popup.waitFor({ timeout: 5_000 })
      if (!(await popup.innerText()).includes('timer1')) throw new Error('timer1 is not offered')
      await ctx.shot('saved-03-completion')
      await ctx.page.keyboard.press('Tab')
      await popup.waitFor({ state: 'hidden', timeout: 5_000 })
      const text = await payloadText(ctx.page)
      if (text.replace(/\s/g, '') !== PAYLOAD) throw new Error(`payload is ${JSON.stringify(text)}`)
      const topic = await ctx.page.locator(tid('publish-topic')).inputValue()
      if (topic !== TOPIC) throw new Error(`topic is ${topic}`)
    })

    await step('▶ in the list publishes it without touching the draft', async () => {
      await setPayload(ctx, 'draft stays')
      await ctx.click('publish-saved')
      const row = ctx.page.locator(tid('publish-saved-row', '[data-name="timer1"]'))
      await row.hover()
      await row.locator(tid('publish-saved-send')).click()
      await waitForRow(ctx, TOPIC, 'out')
      await waitForToast(ctx.page, 'Published timer1')
      await ctx.page.keyboard.press('Escape')
      if ((await payloadText(ctx.page)) !== 'draft stays') throw new Error('the draft changed')
      await dismissToasts(ctx.page)
    })

    await step('the palette loads it into the draft', async () => {
      await setTopic(ctx, 'e2e/other')
      await runPalette(ctx, 'saved message timer1')
      await sleep(200)
      const text = await payloadText(ctx.page)
      if (text.replace(/\s/g, '') !== PAYLOAD) throw new Error(`payload is ${JSON.stringify(text)}`)
    })

    await step('a retained publish offers Undo, which clears it on the broker', async () => {
      await setTopic(ctx, TOPIC)
      await ctx.click('publish-retain')
      await ctx.waitForTestId('publish-retain', { extra: '[aria-pressed="true"]' })
      await ctx.click('publish-button')
      const toast = await waitForToast(ctx.page, `Retained on ${TOPIC}`)
      const kept = await retainedOn(ctx, TOPIC)
      if (kept?.replace(/\s/g, '') !== PAYLOAD) throw new Error(`retained is ${kept}`)
      await capture('saved-04-retained-undo')
      await toast.getByRole('button', { name: 'Undo' }).click()
      await waitForToast(ctx.page, 'Retained message cleared')
      const after = await retainedOn(ctx, TOPIC)
      if (after !== null) throw new Error(`still retained: ${after}`)
      await ctx.click('publish-retain')
      await dismissToasts(ctx.page)
    })
  }
}
