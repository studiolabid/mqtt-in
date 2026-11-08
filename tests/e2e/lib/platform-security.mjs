/**
 * platform-security probes. The page-side functions run inside the app's page (page.evaluate);
 * the main-side ones load pages into the window through webContents (never through a user
 * gesture), so Playwright's page is never left waiting for a cancelled navigation.
 */
import { pathToFileURL } from 'node:url'
import { inPage, waitFor } from './platform.mjs'

export const APP_INDEX = 'app://mqtey/index.html'
const WIN_INI = process.platform === 'win32' ? 'file:///C:/Windows/win.ini' : 'file:///etc/hosts'

/** A page for the IPC guard: it calls the bridge and records the answer in window.__ipc. */
export const IPC_PAGE =
  '<!doctype html><title>file page</title><script>' +
  'window.__ipc = "pending";' +
  'window.mqtey.connections.list().then(' +
  '(list) => { window.__ipc = "allowed:" + list.length },' +
  '(err) => { window.__ipc = "denied:" + err.message })' +
  '</script>'

/** A script outside the app folder: it must never run in the app's page. */
export const OUTSIDE_SCRIPT = 'window.__outsideRan = "ran"\n'

/** In the page: file:// through fetch, XHR, an iframe and a script element. */
export function probeLocalFiles({ winIni, scriptUrl }) {
  const frame = (src) =>
    new Promise((resolve) => {
      const f = document.createElement('iframe')
      f.src = src
      f.style.cssText = 'position:fixed;width:10px;height:10px;opacity:0'
      const done = (value) => {
        f.remove()
        resolve(value)
      }
      f.onload = () => {
        try {
          const text = f.contentDocument?.body?.innerText
          done(text ? `readable: ${text.slice(0, 40)}` : 'no readable document')
        } catch {
          done('no readable document (cross-origin)')
        }
      }
      setTimeout(() => done('no load event'), 1500)
      document.body.append(f)
    })
  const xhr = (url) =>
    new Promise((resolve) => {
      try {
        const request = new XMLHttpRequest()
        request.open('GET', url)
        request.onload = () => resolve(`loaded ${request.status}: ${request.responseText.slice(0, 40)}`)
        request.onerror = () => resolve('error')
        request.send()
      } catch (error) {
        resolve(`threw ${error.message}`)
      }
    })
  const script = (src) =>
    new Promise((resolve) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = () => resolve('load')
      s.onerror = () => resolve('error')
      setTimeout(() => resolve('timeout'), 3000)
      document.head.append(s)
    })
  return (async () => ({
    fetch: await fetch(winIni).then(
      async (r) => `status ${r.status}: ${(await r.text()).slice(0, 40)}`,
      (error) => `rejected: ${error.message}`
    ),
    xhr: await xhr(winIni),
    iframe: await frame(winIni),
    script: await script(scriptUrl),
    scriptRan: window.__outsideRan ?? 'did not run'
  }))()
}

/** In the page: an iframe of the app itself (the CSP says frame-src 'none'). */
export function probeAppFrame(src) {
  return new Promise((resolve) => {
    const f = document.createElement('iframe')
    f.src = src
    f.style.cssText = 'position:fixed;width:10px;height:10px;opacity:0'
    const done = (value) => {
      f.remove()
      resolve(value)
    }
    f.onload = () => {
      try {
        done(f.contentDocument?.querySelector('#app') ? 'the app loaded in a frame' : 'no app document')
      } catch {
        done('no readable document (cross-origin)')
      }
    }
    setTimeout(() => done('no load event'), 1500)
    document.body.append(f)
  })
}

/** In the page: what app:// answers (status and type, or the network error). */
export function probeAppScheme() {
  const status = (url, init) =>
    fetch(url, init).then(
      (r) => `${r.status} ${r.headers.get('content-type') ?? ''}`.trim(),
      (error) => `error: ${error.message}`
    )
  return (async () => ({
    index: await status('app://mqtey/index.html'),
    encodedDots: await status('app://mqtey/..%2F..%2Fpackage.json'),
    encodedDots2: await status('app://mqtey/assets/%2e%2e%2f%2e%2e%2fpackage.json'),
    backslash: await status('app://mqtey/..%5C..%5Cpackage.json'),
    drive: await status('app://mqtey/C:/Windows/win.ini'),
    missing: await status('app://mqtey/missing.js'),
    post: await status('app://mqtey/index.html', { method: 'POST', body: 'x' })
  }))()
}

/** Navigation attempts the page may make on its own (each must be blocked). */
export const NAVIGATIONS = {
  'location.href': "location.href = 'https://example.com/'",
  'an anchor click':
    "(() => { const a = document.createElement('a'); a.href = 'http://example.org/x'; document.body.append(a); a.click(); a.remove() })()",
  'a meta refresh':
    "(() => { const m = document.createElement('meta'); m.httpEquiv = 'refresh'; m.content = '0;url=https://example.net/'; document.head.append(m) })()",
  'a form post':
    "(() => { const f = document.createElement('form'); f.action = 'https://example.com/post'; f.method = 'post'; document.body.append(f); f.submit(); f.remove() })()",
  'a file:// link': `location.href = '${WIN_INI}'`
}

/** The window's URL, as main sees it. */
export const windowUrl = (app) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL())

/**
 * Loads `url` into the window from main. Resolves 'loaded' or 'rejected: <message>' (a failed
 * load rejects), never throws.
 */
export function loadFromMain(app, url) {
  return app.evaluate(async ({ BrowserWindow }, target) => {
    try {
      await BrowserWindow.getAllWindows()[0].webContents.loadURL(target)
      return 'loaded'
    } catch (error) {
      return `rejected: ${error.message}`
    }
  }, url)
}

/** Loads the app page again (after a test page) and waits for the welcome screen. */
export async function reloadApp(ctx) {
  const result = await loadFromMain(ctx.app, APP_INDEX)
  if (result !== 'loaded') throw new Error(`the app page did not load again: ${result}`)
  await ctx.waitForTestId('welcome', { timeout: 15_000 })
}

/** The IPC page as a file:// URL, and what it reported (polled through main). */
export async function ipcFromFilePage(app, file) {
  const url = pathToFileURL(file).href
  const loaded = await loadFromMain(app, url)
  if (loaded !== 'loaded') throw new Error(`the file page did not load: ${loaded}`)
  return waitFor(
    async () => {
      const answer = await inPage(app, 'window.__ipc')
      return answer.ready && answer.value && answer.value !== 'pending' ? answer.value : null
    },
    { timeout: 10_000, label: 'the file page to call the bridge' }
  )
}

export { WIN_INI }
