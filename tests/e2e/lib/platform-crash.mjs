/**
 * platform-crash helpers (IN-05 (2), SEC-12).
 *
 * A renderer crash makes Chromium re-focus the new web contents, which ACTIVATES its window (the
 * user's keystrokes would go to the invisible automation window). Automation windows must be
 * impossible to activate first (`focusable: false`, WS_EX_NOACTIVATE on Windows; hand-off to
 * final for src/main/window-options.ts). `activationGate` reads that (read-only), and
 * `restartRenderer(…, { how: 'crash' })` refuses to crash anything while the gate is closed.
 * A plain reload ('reload') is safe either way: the page never had the focus, so nothing is
 * re-focused.
 *
 * After a crash Playwright's page stays 'Target crashed' although main reloads the window, so
 * everything afterwards goes through main (inPage, capturePage).
 */
import { join } from 'node:path'
import { capturePage } from '../kit.mjs'
import { inPage, mainLog, nativeHandle, waitFor, winStyle } from './platform.mjs'
import { readWindowFacts } from './platform-window.mjs'

/**
 * `{ safe, reason, facts }`: safe only when the window cannot be activated (isFocusable() false
 * and, on Windows, WS_EX_NOACTIVATE set).
 */
export async function activationGate(app) {
  const facts = await readWindowFacts(app)
  const blocked = []
  if (facts.focusable !== false) blocked.push(`BrowserWindow.isFocusable() is ${facts.focusable}`)
  if (process.platform === 'win32' && facts.native?.noActivate !== true) {
    blocked.push('WS_EX_NOACTIVATE is clear')
  }
  return { safe: blocked.length === 0, reason: blocked.join('; '), facts }
}

/**
 * `<hash> <status>` of the open workspace in a NEW document ('old document' while the page that
 * was marked before the restart still answers, '' while no workspace is shown).
 */
const WORKSPACE =
  '(() => { if (window.__e2eBeforeRestart) return "old document"; ' +
  'const el = document.querySelector(\'[data-testid="workspace-connect"]\'); ' +
  'return el ? `${location.hash} ${el.dataset.status}` : "" })()'

/**
 * Restarts the first window's renderer — `how`: 'crash' (forcefullyCrashRenderer; main reloads
 * it) or 'reload' (webContents.reload) — and waits until the workspace of `connectionId` is back
 * and connected. A crash is refused (throws) unless `activationGate` is open. Resolves
 * `{ ms, workspace, sessions, focused, foreground, shot }`.
 */
export async function restartRenderer(ctx, connectionId, { how = 'crash', timeout = 15_000 } = {}) {
  let hwnd
  if (how === 'crash') {
    const gate = await activationGate(ctx.app)
    if (!gate.safe)
      throw new Error(`refusing to crash a window that can be activated: ${gate.reason}`)
    hwnd = gate.facts.hwnd
  } else {
    hwnd = await nativeHandle(ctx.app)
  }
  const marked = await inPage(ctx.app, '(window.__e2eBeforeRestart = true)')
  if (!marked.ready) throw new Error(`the page did not answer before the ${how}: ${marked.reason}`)
  const started = Date.now()
  await ctx.app.evaluate(({ BrowserWindow }, mode) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    if (mode === 'crash') contents.forcefullyCrashRenderer()
    else contents.reload()
  }, how)
  const want = `#/connections/${connectionId} connected`
  const workspace = await waitFor(
    async () => {
      const answer = await inPage(ctx.app, WORKSPACE)
      return answer.ready && answer.value === want ? answer.value : null
    },
    { timeout, interval: 200, label: `the workspace (${want}) after the ${how}` }
  )
  const ms = Date.now() - started
  const sessions = await inPage(ctx.app, 'window.mqttIn.mqtt.getSessions()')
  const focused = await ctx.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].isFocused()
  )
  const native = await winStyle({ hwnd })
  const shot = await capturePage(ctx.app, join(ctx.artifacts, `${how}-back.png`))
  return {
    ms,
    workspace,
    sessions: sessions.ready ? sessions.value : null,
    focused,
    foreground: native ? native.foregroundHwnd === hwnd : false,
    shot
  }
}

/** The '[render-process-gone]' line of a crash in main.log, or null. */
export const crashLogLine = (handle) =>
  mainLog(handle)
    .split('\n')
    .find((line) => /\[render-process-gone\] \{"reason":"crashed"/.test(line)) ?? null
