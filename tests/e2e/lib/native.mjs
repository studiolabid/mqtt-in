/**
 * Native stubs in the main process: nothing an e2e run does may open a native dialog, the file
 * manager, the browser or another process, or touch the system clipboard. Every stub records its
 * call (`nativeCalls`) and returns a harmless default: dialogs are cancelled, unless a test
 * queued a result (`nextDialogResult`).
 */

/** The stubs. `required` ones must take effect (or the launch fails). */
function installStubs(electron) {
  const { app, clipboard, dialog, shell } = electron
  const state = (globalThis.__mqteyE2E ??= { calls: [], next: {}, stubs: {}, skipped: [] })
  const clean = (value) => {
    if (value === null || value === undefined) return value ?? null
    if (typeof value === 'function') return '[function]'
    if (value?.constructor?.name === 'BrowserWindow') return '[BrowserWindow]'
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return String(value)
    }
  }
  const make = (name, fallback, isAsync) => {
    const stub = (...args) => {
      state.calls.push({ name, args: args.map(clean), at: Date.now() })
      const queue = state.next[name]
      const next = queue && queue.length > 0 ? queue.shift() : fallback
      const result = next && typeof next === 'object' ? structuredClone(next) : next
      return isAsync ? Promise.resolve(result) : result
    }
    return stub
  }
  const table = [
    [dialog, 'dialog', 'showOpenDialog', { canceled: true, filePaths: [] }, true, true],
    [dialog, 'dialog', 'showSaveDialog', { canceled: true, filePath: '' }, true, true],
    [dialog, 'dialog', 'showMessageBox', { response: 0, checkboxChecked: false }, true, true],
    [dialog, 'dialog', 'showErrorBox', undefined, false, true],
    [dialog, 'dialog', 'showOpenDialogSync', undefined, false, false],
    [dialog, 'dialog', 'showSaveDialogSync', undefined, false, false],
    [dialog, 'dialog', 'showMessageBoxSync', 0, false, false],
    [dialog, 'dialog', 'showCertificateTrustDialog', undefined, true, false],
    [shell, 'shell', 'openExternal', undefined, true, true],
    [shell, 'shell', 'showItemInFolder', undefined, false, true],
    [shell, 'shell', 'openPath', '', true, true],
    [shell, 'shell', 'trashItem', undefined, true, false],
    [shell, 'shell', 'beep', undefined, false, false],
    [app, 'app', 'relaunch', undefined, false, false],
    [clipboard, 'clipboard', 'writeText', undefined, false, false],
    [clipboard, 'clipboard', 'write', undefined, false, false],
    [clipboard, 'clipboard', 'clear', undefined, false, false]
  ]
  const missing = []
  for (const [target, group, method, fallback, isAsync, required] of table) {
    const name = `${group}.${method}`
    if (typeof target?.[method] !== 'function') continue
    if (target[method] !== state.stubs[name]) {
      const stub = make(name, fallback, isAsync)
      try {
        target[method] = stub
      } catch {
        // read-only: checked below
      }
      state.stubs[name] = stub
    }
    if (target[method] !== state.stubs[name]) {
      if (required) missing.push(name)
      else if (!state.skipped.includes(name)) state.skipped.push(name)
    }
  }
  // The Edit menu's copy / cut / paste roles call these: record instead of using the clipboard.
  const patchContents = (contents) => {
    for (const method of ['copy', 'cut', 'paste', 'pasteAndMatchStyle']) {
      const name = `webContents.${method}`
      contents[method] = state.stubs[name] ??= make(name, undefined, false)
    }
  }
  if (!state.watching) {
    state.watching = true
    app.on('web-contents-created', (_event, contents) => patchContents(contents))
  }
  for (const contents of electron.webContents.getAllWebContents()) patchContents(contents)
  return missing
}

/** Proof, from a second evaluate: the stubs are still in place and a call through main lands. */
function proveStubs({ dialog, shell }) {
  const state = globalThis.__mqteyE2E
  if (!state) return 'no stub state'
  const pairs = [
    [dialog.showOpenDialog, 'dialog.showOpenDialog'],
    [dialog.showSaveDialog, 'dialog.showSaveDialog'],
    [dialog.showMessageBox, 'dialog.showMessageBox'],
    [dialog.showErrorBox, 'dialog.showErrorBox'],
    [shell.openExternal, 'shell.openExternal'],
    [shell.showItemInFolder, 'shell.showItemInFolder'],
    [shell.openPath, 'shell.openPath']
  ]
  const lost = pairs.filter(([fn, name]) => fn !== state.stubs[name]).map(([, name]) => name)
  if (lost.length > 0) return `not stubbed: ${lost.join(', ')}`
  // Safe: showErrorBox is our stub (checked above), so this only records.
  const marker = `mqtey-e2e-stub-check-${Date.now()}`
  dialog.showErrorBox('mqtey e2e', marker)
  const index = state.calls.findIndex((call) => call.args[1] === marker)
  if (index === -1) return 'the stub did not record the check call'
  state.calls.splice(index, 1)
  return 'ok'
}

/**
 * Stubs, in the main process, dialog.showOpenDialog / showSaveDialog / showMessageBox /
 * showErrorBox (+ the sync variants), shell.openExternal / showItemInFolder / openPath /
 * trashItem, app.relaunch, clipboard writes and the Edit menu's copy / cut / paste, then proves
 * that they took effect. Idempotent. launchApp calls it before the first window opens.
 */
export async function stubNativeShell(app) {
  const missing = await app.evaluate(installStubs)
  if (missing.length > 0) throw new Error(`native stubs did not take effect: ${missing.join(', ')}`)
  const proof = await app.evaluate(proveStubs)
  if (proof !== 'ok') throw new Error(`native stubs are not in place: ${proof}`)
}

/** 'showSaveDialog' → 'dialog.showSaveDialog'; qualified names pass through. */
function qualify(name) {
  if (name.includes('.')) return name
  if (['openExternal', 'showItemInFolder', 'openPath', 'trashItem', 'beep'].includes(name)) {
    return `shell.${name}`
  }
  if (name === 'relaunch') return 'app.relaunch'
  return name.startsWith('show') ? `dialog.${name}` : name
}

/**
 * The recorded native calls, oldest first: `{ name, args, at }` (`name` is qualified, e.g.
 * 'dialog.showSaveDialog'; window arguments are '[BrowserWindow]'). With `name` (short or
 * qualified), only those calls.
 */
export async function nativeCalls(app, name) {
  const calls = await app.evaluate(() => globalThis.__mqteyE2E?.calls ?? [])
  return name ? calls.filter((call) => call.name === qualify(name)) : calls
}

/** Forgets the recorded native calls. */
export async function clearNativeCalls(app) {
  await app.evaluate(() => {
    if (globalThis.__mqteyE2E) globalThis.__mqteyE2E.calls = []
  })
}

/**
 * Queues the result of the next call of a stubbed function, e.g.
 * `nextDialogResult(app, 'showSaveDialog', { canceled: false, filePath })`. One result per
 * expected call (first in, first out); without one, the default (cancelled) applies.
 */
export async function nextDialogResult(app, name, result) {
  await app.evaluate(
    (_electron, { key, value }) => {
      const state = globalThis.__mqteyE2E
      if (!state) throw new Error('stubNativeShell has not run in this app')
      ;(state.next[key] ??= []).push(value)
    },
    { key: qualify(name), value: result }
  )
}
