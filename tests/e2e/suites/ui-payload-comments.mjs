/**
 * JSON comments in the publisher and "Publish to topic" in the message menu: right-clicking a
 * message puts its topic into the publisher (payload untouched); Ctrl+/ comments the current
 * line out (greyed), the publish leaves it out (trailing comma included), and Ctrl+/ again
 * brings it back.
 */
import { sleep, tid } from '../kit.mjs'
import { createConnection, publishAll, subscribe, waitForRow } from '../lib/ui.mjs'

const TOPIC = 'e2e/comment/cmd'
const PAYLOAD = '{\n"id": 4,\n"cmd": "timer",\n"min": 5\n}'

const editor = (page) => page.locator(tid('publish-payload', ' .cm-content'))

export default {
  name: 'ui-payload-comments',
  order: 42,
  broker: true,

  async run(ctx) {
    const { step, capture } = ctx

    await step('launch, connect and receive a message', async () => {
      await ctx.launch({ size: { width: 1280, height: 800 } })
      await createConnection(ctx, { name: 'Comments' })
      await subscribe(ctx, '#')
      const client = await ctx.rawClient()
      await publishAll(client, TOPIC, ['{"state":"idle"}'])
      await client.close()
      await waitForRow(ctx, TOPIC, 'in')
    })

    await step("'Publish to topic' in the row menu fills the topic only", async () => {
      await editor(ctx.page).click()
      await ctx.page.keyboard.press('ControlOrMeta+A')
      await ctx.page.keyboard.press('Delete')
      await ctx.page.keyboard.insertText(PAYLOAD)
      const row = ctx.page.locator(
        tid('message-row', `[data-topic="${TOPIC}"][data-direction="in"]`)
      )
      await row.first().click({ button: 'right' })
      await ctx.page.getByRole('menuitem', { name: 'Publish to topic' }).click()
      const topic = await ctx.page.inputValue(tid('publish-topic'))
      if (topic !== TOPIC) throw new Error(`the publish topic is "${topic}", want "${TOPIC}"`)
      const text = await editor(ctx.page).innerText()
      if (!text.includes('"min": 5')) throw new Error(`the payload changed: ${text}`)
    })

    await step('Ctrl+/ comments a line out and the publish leaves it out', async () => {
      await editor(ctx.page).click()
      await ctx.page.keyboard.press('ControlOrMeta+End')
      await ctx.page.keyboard.press('ArrowUp') // the "min" line
      await ctx.page.keyboard.press('ControlOrMeta+/')
      const text = await editor(ctx.page).innerText()
      if (!text.includes('// "min": 5')) throw new Error(`no comment after Ctrl+/: ${text}`)
      const marks = await ctx.page.locator(tid('publish-payload', ' .cm-json-comment')).count()
      if (marks !== 1) throw new Error(`${marks} greyed-out comments, want 1`)
      await capture('comments-01-commented')

      const client = await ctx.rawClient()
      try {
        const received = new Promise((resolve, reject) => {
          client.on('message', (_topic, payload) => resolve(payload.toString('utf8')))
          setTimeout(() => reject(new Error('nothing received')), 5_000)
        })
        await client.subscribeAsync(TOPIC)
        await sleep(200) // let the subscription settle
        await ctx.page.keyboard.press('ControlOrMeta+Enter')
        const payload = await received
        const value = JSON.parse(payload)
        if (value.min !== undefined || value.id !== 4 || value.cmd !== 'timer') {
          throw new Error(`published ${payload}`)
        }
        ctx.log(`published ${JSON.stringify(payload)}`)
      } finally {
        await client.close()
      }
    })

    await step('Ctrl+/ again uncomments the line', async () => {
      await editor(ctx.page).click()
      await ctx.page.keyboard.press('ControlOrMeta+End')
      await ctx.page.keyboard.press('ArrowUp')
      await ctx.page.keyboard.press('ControlOrMeta+/')
      const text = await editor(ctx.page).innerText()
      if (text.includes('//')) throw new Error(`still commented: ${text}`)
      const marks = await ctx.page.locator(tid('publish-payload', ' .cm-json-comment')).count()
      if (marks !== 0) throw new Error(`${marks} greyed-out comments, want 0`)
    })
  }
}
