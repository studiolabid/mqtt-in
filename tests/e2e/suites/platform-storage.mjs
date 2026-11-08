/**
 * IN-05 (1) and (3), SEC-09 / SEC-01, and the storage IPC surface (CT-01..CT-04), in seeded
 * profiles: no notices in a fresh profile; exports without secrets; known files only for 'Show
 * file', which never reaches the shell in automation; the import outcome; a damaged
 * connections.json restored from its last good copy, or reported (with 'Show file') when there is
 * none; and (Windows) a connections.json another process holds open is never overwritten.
 * Dialogs and the shell are stubbed by the kit before the first window.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeCalls, nextDialogResult, removeProfile } from '../kit.mjs'
import { connectionProfile, expect, toast, waitFor } from '../lib/platform.mjs'
import {
  CORRUPT_COPY,
  holdFileLock,
  outcome,
  SAVED,
  SAVED_TEXT,
  truncated
} from '../lib/platform-storage.mjs'

const UNKNOWN_FILE = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts'
const notices = (page) => page.evaluate(() => window.mqtey.app.getStorageNotices())
const names = async (page) =>
  (await page.evaluate(() => window.mqtey.connections.list())).map((profile) => profile.name)

/** 'Show file' on the toast: resolves without a shell call (automation only logs it). */
async function showFileWithoutShell(ctx, title, path) {
  const box = toast(ctx.page, title)
  await box.waitFor({ timeout: 10_000 })
  await box.getByRole('button', { name: 'Show file' }).click()
  await ctx.page.mouse.move(1, 1)
  await waitFor(() => ctx.handle.output().includes(`not opening the file manager for ${path}`), {
    timeout: 5_000,
    label: "main's 'not opening the file manager' line"
  })
  const shell = await nativeCalls(ctx.app, 'showItemInFolder')
  expect(shell.length === 0, 'shell.showItemInFolder was called', shell)
  const failed = await toast(ctx.page, 'Could not show the file').count()
  expect(failed === 0, "'Show file' reported an error")
}

export default {
  name: 'platform-storage',
  order: 22,

  async run(ctx) {
    const { step, log } = ctx

    await step('a fresh profile has no storage notices', async () => {
      await ctx.launch()
      const list = await notices(ctx.page)
      expect(list.length === 0, 'a fresh profile has storage notices', list)
    })

    await step("'Show file' refuses files main does not know", async () => {
      const refused = await outcome(
        ctx.page.evaluate((path) => window.mqtey.app.showItemInFolder(path), UNKNOWN_FILE)
      )
      expect(!refused.ok && /Unknown file/.test(refused.error), 'not refused', refused)
    })

    await step('exports leave secrets out unless asked, and can be revealed', async () => {
      const page = ctx.page
      await page.evaluate(
        (profile) => window.mqtey.connections.save(profile),
        connectionProfile({ id: 'secret', username: 'ops', password: 'hunter2-SECRET' })
      )
      const plain = join(ctx.handle.userData, 'export-default.json')
      await nextDialogResult(ctx.app, 'showSaveDialog', { canceled: false, filePath: plain })
      const written = await page.evaluate(() =>
        window.mqtey.connections.exportToFile(undefined, { includeSecrets: false })
      )
      expect(written === plain, 'the export did not go to the chosen file', written)
      const text = ctx.handle.readFile('export-default.json') ?? ''
      expect(text.includes('"ops"') && !text.includes('SECRET'), 'the default export has secrets')
      const secrets = join(ctx.handle.userData, 'export-secrets.json')
      await nextDialogResult(ctx.app, 'showSaveDialog', { canceled: false, filePath: secrets })
      await page.evaluate(() => window.mqtey.connections.exportToFile(undefined, { includeSecrets: true }))
      expect(
        (ctx.handle.readFile('export-secrets.json') ?? '').includes('hunter2-SECRET'),
        'includeSecrets: true left the password out'
      )
      const invalid = await outcome(
        page.evaluate(() => window.mqtey.connections.exportToFile(undefined, { includeSecrets: 'yes' }))
      )
      expect(!invalid.ok && /Invalid export options/.test(invalid.error), 'bad options', invalid)
      const reveal = await outcome(
        page.evaluate((path) => window.mqtey.app.showItemInFolder(path), plain)
      )
      expect(reveal.ok, 'an exported file cannot be revealed', reveal)
      await waitFor(() => ctx.handle.output().includes(`not opening the file manager for ${plain}`), {
        timeout: 5_000,
        label: "main's 'not opening the file manager' line"
      })
      const shell = await nativeCalls(ctx.app, 'showItemInFolder')
      expect(shell.length === 0, 'shell.showItemInFolder was called', shell)
    })

    await step('an import reports what it took, skipped and found twice', async () => {
      const file = join(ctx.handle.userData, 'import.json')
      writeFileSync(
        file,
        JSON.stringify({
          app: 'mqtey',
          version: 1,
          connections: [
            { name: 'Imported broker', host: 'broker.local', clientId: 'plant-gw-1' },
            { name: 'Broken entry', host: 'broker.local', port: 99_999 }
          ]
        })
      )
      await nextDialogResult(ctx.app, 'showOpenDialog', { canceled: false, filePaths: [file] })
      const result = await ctx.page.evaluate(() => window.mqtey.connections.importFromFile())
      log(`imported ${result?.imported?.length}, skipped ${JSON.stringify(result?.skipped)}`)
      expect(
        result?.imported?.length === 1 &&
          result.imported[0].clientId === 'plant-gw-1' &&
          result.skipped.length === 1 &&
          result.skipped[0].name === 'Broken entry' &&
          typeof result.skipped[0].reason === 'string' &&
          !('index' in result.skipped[0]) &&
          result.duplicates === 0 &&
          result.tlsPathsCleared === 0 &&
          result.source === 'mqtey',
        'unexpected import result',
        result
      )
      const again = join(ctx.handle.userData, 'export-default.json')
      await nextDialogResult(ctx.app, 'showOpenDialog', { canceled: false, filePaths: [again] })
      const twice = await ctx.page.evaluate(() => window.mqtey.connections.importFromFile())
      expect(
        twice?.imported?.length === 0 && twice.duplicates === 1,
        'importing an export of saved connections added copies',
        twice
      )
    })

    await step('a notice pushed by main reaches onStorageNotice', async () => {
      const notice = { kind: 'write-failed', file: 'storage.json', message: 'e2e', timestamp: 7 }
      await ctx.page.evaluate(() => {
        window.__e2eNotices = []
        window.__e2eOff = window.mqtey.app.onStorageNotice((n) => window.__e2eNotices.push(n))
      })
      await ctx.app.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()[0].webContents.send('app:event:storage-notice', payload)
      }, notice)
      const received = await waitFor(
        () => ctx.page.evaluate(() => window.__e2eNotices[0] ?? null),
        { timeout: 5_000, label: 'the pushed notice' }
      )
      await ctx.page.evaluate(() => window.__e2eOff())
      expect(JSON.stringify(received) === JSON.stringify(notice), 'a different notice', received)
      await toast(ctx.page, 'Changes could not be saved').waitFor({ timeout: 5_000 })
      await ctx.handle.close()
    })

    await step('a damaged connections.json is restored from its last good copy', async () => {
      await ctx.launch({
        seed: {
          'data/connections.json': truncated(SAVED_TEXT),
          'data/connections.bak.json': SAVED_TEXT
        }
      })
      const restored = await names(ctx.page)
      expect(restored.join() === SAVED.map((p) => p.name).join(), 'not restored', restored)
      const notice = (await notices(ctx.page)).find((n) => n.kind === 'restored-backup')
      expect(
        notice?.file === 'connections.json' && CORRUPT_COPY.test(notice.path ?? ''),
        "no 'restored-backup' notice for the damaged copy",
        notice
      )
      expect(ctx.handle.readFile('data/connections.json') === SAVED_TEXT, 'the file is not restored')
      await ctx.page.locator(ctx.tid('connection-item')).nth(1).waitFor()
      await toast(ctx.page, 'Saved connections restored from backup').waitFor({ timeout: 10_000 })
      await ctx.capture('storage-restored-backup')
      await showFileWithoutShell(ctx, 'Saved connections restored from backup', notice.path)
      await ctx.handle.close()
    })

    await step('a damaged connections.json without a backup is reported', async () => {
      await ctx.launch({ seed: { 'data/connections.json': '[{"id":"x","name":"Broken", "host": "lo' } })
      const notice = (await notices(ctx.page)).find((n) => n.file === 'connections.json')
      expect(
        notice?.kind === 'corrupt' && CORRUPT_COPY.test(notice.path ?? ''),
        "no 'corrupt' notice",
        notice
      )
      expect((await names(ctx.page)).length === 0, 'connections appeared from nowhere')
      await ctx.waitForTestId('welcome')
      await toast(ctx.page, 'Saved connections could not be read').waitFor({ timeout: 10_000 })
      await ctx.shot('storage-corrupt')
      await showFileWithoutShell(ctx, 'Saved connections could not be read', notice.path)
      await ctx.handle.close()
    })

    if (process.platform !== 'win32') {
      log('skipped: the locked-file case needs Windows (FileShare.None)')
      return
    }

    await step('a connections.json held by another process is never overwritten', async () => {
      let lock = null
      const handle = await ctx
        .launch({
          seed: async (dir) => {
            const file = join(dir, 'data', 'connections.json')
            mkdirSync(join(dir, 'data'), { recursive: true })
            writeFileSync(file, SAVED_TEXT)
            lock = await holdFileLock(file)
          }
        })
        .catch(async (error) => {
          await lock?.release()
          throw error
        })
      try {
        const file = join(handle.userData, 'data', 'connections.json')
        log(`PowerShell pid ${lock.pid} holds ${file}`)
        const notice = (await notices(ctx.page)).find((n) => n.file === 'connections.json')
        expect(
          notice?.kind === 'unreadable' &&
            notice.path === file &&
            notice.message.startsWith('Could not read connections.json'),
          "no 'unreadable' notice",
          notice
        )
        expect((await names(ctx.page)).length === 0, 'the locked profiles were read')
        await toast(ctx.page, 'Saved connections could not be read').waitFor({ timeout: 10_000 })
        await ctx.shot('storage-locked')
      } finally {
        expect(await lock.release(), 'the lock was not released normally')
      }
      // The user's first change of the session, once the other process let go of the file.
      await ctx.page.evaluate(
        (profile) => window.mqtey.connections.save(profile),
        connectionProfile({ id: 'new-1', name: 'My new connection' })
      )
      await ctx.sleep(600)
      await handle.close({ keepProfile: true })
      try {
        expect(handle.readFile('data/connections.json') === SAVED_TEXT, 'connections.json changed')
        const pending = JSON.parse(handle.readFile('data/connections.pending.json') ?? 'null')
        expect(
          pending?.connections?.map((p) => p.name).join() === 'My new connection',
          'the change is not in connections.pending.json',
          pending
        )
      } finally {
        removeProfile(handle.userData)
      }
    })
  }
}
