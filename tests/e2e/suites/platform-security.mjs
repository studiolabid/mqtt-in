/**
 * IN-06 (SEC-05, SEC-17) and the app:// origin (MS-11, MS-12, MS-15) in the running app:
 * - the UI runs on app://mqtt-in, and every resource comes from there;
 * - file:// is out of reach (fetch, XHR, iframe, an injected script from outside the app);
 * - frames are blocked by the CSP (frame-src 'none'; that step expects the CSP console error);
 * - app:// serves only the app's own files (traversal and POST refused);
 * - navigations the page starts are blocked and never open the browser; window.open opens http(s)
 *   in the (stubbed) browser exactly once;
 * - IPC from any page but the app's own main frame is refused ('Untrusted IPC sender');
 * - a missing page fails to load (ERR_FAILED), is logged in main.log, and shows no dialog.
 * shell.openExternal and every dialog are stubbed by the kit before the first window.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { clearNativeCalls, nativeCalls } from '../kit.mjs'
import { expect, inPage, mainLog, waitFor } from '../lib/platform.mjs'
import {
  APP_INDEX,
  ipcFromFilePage,
  IPC_PAGE,
  loadFromMain,
  NAVIGATIONS,
  OUTSIDE_SCRIPT,
  probeAppFrame,
  probeAppScheme,
  probeLocalFiles,
  reloadApp,
  WIN_INI,
  windowUrl
} from '../lib/platform-security.mjs'

/** Console errors Chromium prints for the blocked file:// requests. */
const FILE_ERRORS = [
  /Not allowed to load local resource: file:/,
  /violates the following Content Security Policy directive: "connect-src 'self'"/,
  /Refused to connect because it violates the document's Content Security Policy/
]

export default {
  name: 'platform-security',
  order: 23,

  async run(ctx) {
    const { step, log } = ctx

    await step('the UI runs on app://mqtt-in', async () => {
      await ctx.launch()
      await ctx.waitForTestId('welcome', { timeout: 30_000 })
      const where = await ctx.page.evaluate(() => ({
        href: location.href,
        origin: location.origin,
        secure: isSecureContext,
        resources: [
          ...[...document.scripts].map((s) => s.src).filter(Boolean),
          ...[...document.querySelectorAll('link[href]')].map((l) => l.href)
        ]
      }))
      log(`${where.href}, ${where.resources.length} resources`)
      expect(ctx.page.url().startsWith(APP_INDEX), 'the page is not app://mqtt-in', ctx.page.url())
      expect(where.origin === 'app://mqtt-in', 'the origin is not app://mqtt-in', where.origin)
      expect(where.secure, 'not a secure context')
      expect((await windowUrl(ctx.app)).startsWith(APP_INDEX), 'main loaded another URL')
      const foreign = where.resources.filter((url) => !url.startsWith('app://mqtt-in/'))
      expect(where.resources.length > 0 && foreign.length === 0, 'foreign resources', foreign)
    })

    await step(
      'file:// is out of reach (fetch, XHR, iframe, script)',
      async () => {
        const script = join(ctx.handle.userData, 'outside.js')
        writeFileSync(script, OUTSIDE_SCRIPT)
        const result = await ctx.page.evaluate(probeLocalFiles, {
          winIni: WIN_INI,
          scriptUrl: pathToFileURL(script).href
        })
        log(JSON.stringify(result))
        expect(result.fetch.startsWith('rejected'), 'fetch(file://) was not rejected', result.fetch)
        expect(!result.xhr.startsWith('loaded'), 'XHR read a local file', result.xhr)
        expect(!result.iframe.startsWith('readable'), 'an iframe read a local file', result.iframe)
        expect(result.script !== 'load', 'a script outside the app loaded', result.script)
        expect(result.scriptRan === 'did not run', 'a script outside the app ran')
      },
      { allowErrors: FILE_ERRORS }
    )

    await step(
      "frames are blocked (CSP frame-src 'none')",
      async () => {
        const result = await ctx.page.evaluate(probeAppFrame, APP_INDEX)
        log(result)
        expect(result !== 'the app loaded in a frame', 'the app loaded inside a frame')
      },
      {
        allowErrors: [
          /violates the following Content Security Policy directive: "frame-src 'none'"/
        ]
      }
    )

    await step(
      'app:// serves only the app (traversal and POST refused)',
      async () => {
        const result = await ctx.page.evaluate(probeAppScheme)
        log(JSON.stringify(result))
        expect(result.index.startsWith('200 text/html'), 'the index is not served', result.index)
        for (const key of ['encodedDots', 'encodedDots2', 'backslash', 'drive', 'missing']) {
          expect(result[key].startsWith('error'), `app:// served ${key}`, result[key])
        }
        expect(result.post.startsWith('405'), 'POST was not refused', result.post)
      },
      {
        allowErrors: [
          /Failed to load resource: net::ERR_FAILED/,
          /Failed to load resource: the server responded with a status of 405/
        ]
      }
    )

    await step(
      'navigations the page starts are blocked and never open the browser',
      async () => {
        await clearNativeCalls(ctx.app)
        for (const [label, code] of Object.entries(NAVIGATIONS)) {
          await ctx.page.evaluate(code).catch(() => undefined)
          await ctx.sleep(700)
          const url = await windowUrl(ctx.app)
          expect(url.startsWith(APP_INDEX), `${label} navigated away`, url)
        }
        const opened = await nativeCalls(ctx.app, 'openExternal')
        expect(opened.length === 0, 'a blocked navigation opened the browser', opened)
        await ctx.page.evaluate((file) => {
          window.open('https://example.com/x')
          window.open(file)
        }, WIN_INI)
        const calls = await waitFor(
          async () => {
            const list = await nativeCalls(ctx.app, 'openExternal')
            return list.length > 0 ? list : null
          },
          { timeout: 5_000, label: 'window.open to reach shell.openExternal' }
        )
        await ctx.sleep(300)
        const urls = (await nativeCalls(ctx.app, 'openExternal')).map((call) => call.args[0])
        log(`openExternal: ${JSON.stringify(urls)}`)
        expect(
          JSON.stringify(urls) === JSON.stringify(['https://example.com/x']),
          'window.open did not open exactly the http(s) URL once',
          { first: calls[0], urls }
        )
        // Playwright keeps waiting for the cancelled navigations: load the app page again.
        await reloadApp(ctx)
      },
      {
        allowErrors: [
          /violates the following Content Security Policy directive: "form-action 'none'"/,
          /Not allowed to load local resource: file:/
        ]
      }
    )

    await step('IPC from a page other than the app is refused', async () => {
      const file = join(ctx.handle.userData, 'ipc-page.html')
      writeFileSync(file, IPC_PAGE)
      const answer = await ipcFromFilePage(ctx.app, file)
      log(answer)
      expect(
        answer.startsWith('denied') && answer.includes('Untrusted IPC sender'),
        'a file:// page could call the bridge',
        answer
      )
      await reloadApp(ctx)
      const own = await inPage(ctx.app, 'window.mqttIn.connections.list().then((l) => l.length)')
      expect(own.ready && own.value === 0, 'the app page cannot call the bridge again', own)
    })

    await step('a missing page fails to load without a dialog', async () => {
      const result = await loadFromMain(ctx.app, 'app://mqtt-in/missing.html')
      log(result)
      expect(
        /ERR_FAILED \(-2\)/.test(result),
        'the missing page did not fail with ERR_FAILED',
        result
      )
      const line = await waitFor(
        () =>
          mainLog(ctx.handle)
            .split('\n')
            .find((l) => l.includes('[did-fail-load]') && l.includes('missing.html')),
        { timeout: 5_000, label: "'[did-fail-load]' in main.log" }
      )
      log(line.slice(0, 160))
      const dialogs = (await nativeCalls(ctx.app)).filter((call) => call.name.startsWith('dialog.'))
      expect(dialogs.length === 0, 'a dialog was requested', dialogs)
      const alive = await ctx.app.evaluate(({ app }) => app.isReady())
      expect(alive, 'the app stopped')
      await reloadApp(ctx)
      await ctx.shot('security-after-reload')
    })
  }
}
