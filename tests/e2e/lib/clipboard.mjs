/**
 * Page-side clipboard stub: an e2e run never writes (or reads) the user's real clipboard.
 *
 * - navigator.clipboard.writeText / readText / write / read use an in-page store: `window.__clip`
 *   (the last text written, or null) and `window.__clipWrites` (every write, oldest first);
 * - document.execCommand('copy' | 'cut' | 'paste') and the keyboard shortcuts (Ctrl/⌘+C, X, V,
 *   Ctrl+Insert, Shift+Insert, Shift+Delete) are emulated against that store: the page still gets
 *   its copy / cut / paste events (with a DataTransfer), but the system clipboard is never used.
 *
 * The store lives in the document: a reload starts it empty. launchApp calls stubClipboard(page),
 * which also registers the stub as an init script of that page, so reloads (page.reload, or
 * webContents.reload / loadURL from main) get it before any app code runs; and main installs it
 * at every dom-ready too (stubClipboardFromMain), which covers the reload after a renderer crash.
 * A page you open another way (a CDP connection to a packaged build) needs stubClipboard(page).
 */

/** Runs in the page (also as an init script). Idempotent per document. */
function installClipboardStub() {
  if (window.__clipStubbed) return
  window.__clipStubbed = true
  window.__clip = null
  window.__clipWrites = []
  const write = (text) => {
    window.__clip = String(text)
    window.__clipWrites.push(window.__clip)
  }
  const read = () => window.__clip ?? ''
  const define = (target, name, value) =>
    Object.defineProperty(target, name, { value, configurable: true, writable: true })
  if (navigator.clipboard) {
    define(navigator.clipboard, 'writeText', async (text) => write(text))
    define(navigator.clipboard, 'readText', async () => read())
    define(navigator.clipboard, 'write', async (items) => {
      for (const item of items ?? []) {
        if (!item.types.includes('text/plain')) continue
        write(await (await item.getType('text/plain')).text())
      }
    })
    define(navigator.clipboard, 'read', async () => [
      new ClipboardItem({ 'text/plain': new Blob([read()], { type: 'text/plain' }) })
    ])
  }
  const editable = (el) =>
    el instanceof HTMLElement &&
    (el.isContentEditable || (/^(INPUT|TEXTAREA)$/.test(el.tagName) && !el.readOnly))
  const selectedText = () => {
    const el = document.activeElement
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.selectionEnd) {
      return el.value.slice(el.selectionStart ?? 0, el.selectionEnd)
    }
    return String(document.getSelection() ?? '')
  }
  const native = document.execCommand
  const original = (...args) => native.apply(document, args)
  /** Dispatches a clipboard event the way Chromium does; true when the page handled it. */
  const dispatch = (type, data) => {
    const target = document.activeElement ?? document.body
    const init = { clipboardData: data, bubbles: true, cancelable: true, composed: true }
    return !target.dispatchEvent(new ClipboardEvent(type, init))
  }
  const copy = (type) => {
    const data = new DataTransfer()
    if (dispatch(type, data)) {
      if (data.types.includes('text/plain')) write(data.getData('text/plain'))
      return
    }
    const text = selectedText()
    if (!text) return // nothing selected: a native copy leaves the clipboard alone
    write(text)
    if (type === 'cut' && editable(document.activeElement)) original('delete')
  }
  const paste = () => {
    const data = new DataTransfer()
    data.setData('text/plain', read())
    if (!dispatch('paste', data) && editable(document.activeElement)) {
      original('insertText', false, read())
    }
  }
  define(document, 'execCommand', (command, ...rest) => {
    const name = String(command).toLowerCase()
    if (name === 'copy' || name === 'cut') {
      copy(name)
      return true
    }
    if (name === 'paste') {
      paste()
      return true
    }
    return original(command, ...rest)
  })
  const kindOf = (event) => {
    const raw = String(event.key ?? '')
    const key = raw.length === 1 ? raw.toLowerCase() : raw
    const mod = event.ctrlKey || event.metaKey
    if (event.altKey) return null
    if ((mod && key === 'c') || (event.ctrlKey && key === 'Insert')) return 'copy'
    if ((mod && key === 'x') || (event.shiftKey && key === 'Delete')) return 'cut'
    if ((mod && key === 'v') || (event.shiftKey && key === 'Insert')) return 'paste'
    return null
  }
  // First listener of the capture phase: the native copy / cut / paste is cancelled before any
  // handler can stop the event. The page's handlers still see defaultPrevented only when they
  // call preventDefault themselves; when none did, the action is emulated after them: by the
  // window's last bubble listener, right after a handler that stops the event (dialogs stop
  // Ctrl / ⌘ keys), or at the latest in the next task.
  const jobs = new WeakMap()
  const finish = (event) => jobs.get(event)?.()
  // Writable: page code may replace these methods on the event itself.
  const override = (event, name, value) =>
    Object.defineProperty(event, name, { configurable: true, writable: true, value })
  const guard = (event) => {
    const kind = kindOf(event)
    if (!kind) return
    let handled = event.defaultPrevented
    let done = false
    event.preventDefault()
    Object.defineProperty(event, 'defaultPrevented', { configurable: true, get: () => handled })
    override(event, 'preventDefault', () => {
      handled = true
    })
    const run = () => {
      if (done || handled) return
      done = true
      if (kind === 'paste') paste()
      else copy(kind)
    }
    for (const name of ['stopPropagation', 'stopImmediatePropagation']) {
      const stop = event[name].bind(event)
      override(event, name, () => {
        stop()
        queueMicrotask(run)
      })
    }
    jobs.set(event, run)
    window.removeEventListener('keydown', finish)
    window.addEventListener('keydown', finish)
    setTimeout(run)
  }
  window.addEventListener('keydown', guard, true)
}

/**
 * Second layer, from main (launchApp calls it before the first window opens): every document of
 * the app also gets the stub at dom-ready, including documents Playwright cannot reach (the
 * reload after a renderer crash). Idempotent.
 */
export async function stubClipboardFromMain(app) {
  await app.evaluate(({ app: electronApp, webContents }, source) => {
    const state = (globalThis.__mqttInE2E ??= { calls: [], next: {}, stubs: {}, skipped: [] })
    if (state.clipboardWatch) return
    state.clipboardWatch = true
    const install = (contents) =>
      contents.on('dom-ready', () => {
        contents.executeJavaScript(`(${source})()`).catch(() => undefined)
      })
    for (const contents of webContents.getAllWebContents()) install(contents)
    electronApp.on('web-contents-created', (_event, contents) => install(contents))
  }, installClipboardStub.toString())
}

/** Pages that already carry the stub as an init script. */
const registered = new WeakSet()

/**
 * Installs the stub in `page`'s current document and, once per page, as an init script for its
 * later documents (page.reload, webContents.reload / loadURL from main). Idempotent.
 */
export async function stubClipboard(page) {
  if (!registered.has(page)) {
    registered.add(page)
    await page.addInitScript(installClipboardStub)
  }
  await page.evaluate(installClipboardStub)
  const ok = await page.evaluate(() => window.__clipStubbed === true)
  if (!ok) throw new Error('the clipboard stub did not take effect')
}

/** The last text the page wrote to the (stubbed) clipboard, or null (after pending key copies). */
export const clipboardText = (page) =>
  page.evaluate(() => new Promise((done) => setTimeout(() => done(window.__clip ?? null))))

/** Every text the page wrote to the (stubbed) clipboard, oldest first. */
export const clipboardWrites = (page) =>
  page.evaluate(() => new Promise((done) => setTimeout(() => done(window.__clipWrites ?? []))))

/** Puts `text` on the stubbed clipboard (what a paste or readText then returns). */
export const setClipboardText = (page, text) =>
  page.evaluate((value) => {
    window.__clip = value
  }, String(text))
